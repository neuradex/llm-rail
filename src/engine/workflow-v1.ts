import * as path from "node:path";
import { loadYaml } from "../util.js";
import {
  isAgenticStep,
  isCallStep,
  isProgrammaticStep,
  isRouterStep,
  isV1Workflow,
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../types-v1.js";
import { buildSchemaRegistry } from "./schemas.js";
import { resolveWorkflowPath } from "./variant.js";

// ── Loading ──

export function loadWorkflowV1FromPath(filePath: string): WorkflowV1Def {
  const loaded = loadYaml<unknown>(path.resolve(filePath));
  if (!isV1Workflow(loaded)) {
    throw new Error(
      `File at ${filePath} is not a v1 workflow (missing 'format: ${V1_FORMAT_MARKER}' marker)`,
    );
  }
  return loaded;
}

/**
 * Resolve a workflow by name (using the standard search order: user
 * `workflows/` first, then package `builtins/`) and load it as v1.
 *
 * Throws if the file is not a v1 workflow. Use `loadWorkflowAny` for
 * code that should accept either format.
 */
export function loadWorkflowV1(name: string): WorkflowV1Def {
  const { basePath } = resolveWorkflowPath(name);
  return loadWorkflowV1FromPath(basePath);
}

// ── Validation ──

const RESERVED_NAMES = new Set(["list", "learn", "help", "version"]);

/**
 * Structural validation for a v1 workflow definition.
 *
 * Scope: catches shape-level errors only (required fields, step type
 * well-formedness, schema reference existence, context_in reference
 * existence, router case goto targets). Deeper semantic checks
 * (reachability, IO compatibility, recursion depth) belong to the
 * `lrail wf compile` step introduced in a later PR.
 */
export function validateWorkflowV1Def(def: WorkflowV1Def): string[] {
  const errors: string[] = [];

  // Name
  if (!def.name) errors.push("Workflow must have a name");
  if (def.name && RESERVED_NAMES.has(def.name)) {
    errors.push(`Workflow name '${def.name}' is reserved and cannot be used`);
  }
  if (def.name && /^\d{4}-\d{6}(-\d{3}-[a-f0-9]{4})?$/.test(def.name)) {
    errors.push(`Workflow name '${def.name}' looks like an instance ID and cannot be used`);
  }

  // Phase
  if (def.phase && !["draft", "dev", "stable"].includes(def.phase)) {
    errors.push(`Invalid phase '${def.phase}'. Must be 'draft', 'dev', or 'stable'`);
  }

  // Schemas block must exist (even if empty would be odd; allow empty but
  // input/output references below will then fail).
  if (!def.schemas || typeof def.schemas !== "object") {
    errors.push("Workflow must have a 'schemas' block");
    return errors;
  }

  const { errors: schemaErrors } = buildSchemaRegistry(def.schemas);
  for (const e of schemaErrors) errors.push(e);
  const schemaNames = new Set(Object.keys(def.schemas));

  // input / output references
  if (!def.input) {
    errors.push("Workflow must declare 'input'");
  } else if (!schemaNames.has(def.input)) {
    errors.push(`Workflow input references unknown schema '${def.input}'`);
  }
  if (!def.output) {
    errors.push("Workflow must declare 'output'");
  } else if (!schemaNames.has(def.output)) {
    errors.push(`Workflow output references unknown schema '${def.output}'`);
  }

  // max_depth
  if (def.max_depth !== undefined) {
    if (!Number.isInteger(def.max_depth) || def.max_depth < 1) {
      errors.push(`max_depth must be a positive integer (got ${def.max_depth})`);
    }
  }

  // Steps
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    errors.push("Workflow must have at least one step");
    return errors;
  }

  const stepIds = new Set<string>();
  for (const step of def.steps) {
    if (!step.id) {
      errors.push("Each step must have an id");
      continue;
    }
    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}`);
    }
    stepIds.add(step.id);
  }

  for (const step of def.steps) {
    if (!step.id) continue;
    validateStep(step, schemaNames, stepIds, errors);
  }

  // Policy (same rules as legacy)
  if (def.policy) {
    if (def.policy.mode !== "trail" && def.policy.mode !== "enforce") {
      errors.push("Policy mode must be 'trail' or 'enforce'");
    }
    if (
      def.policy.mode === "enforce" &&
      (!Array.isArray(def.policy.rules) || def.policy.rules.length === 0)
    ) {
      errors.push("Policy in enforce mode must have at least one rule");
    }
  }

  return errors;
}

function validateStep(
  step: V1StepDef,
  schemaNames: Set<string>,
  stepIds: Set<string>,
  errors: string[],
): void {
  const stepLabel = `Step '${step.id}'`;

  // context_in reference check (common to agentic/programmatic/router; call
  // uses `inputs:` instead).
  if ("context_in" in step && step.context_in) {
    for (const [key, val] of Object.entries(step.context_in)) {
      const tmpl = typeof val === "string" ? val : val.from;
      validateContextRef(stepLabel, key, tmpl, stepIds, errors);
      if (typeof val !== "string" && val.type && !schemaNames.has(val.type)) {
        errors.push(
          `${stepLabel} context_in '${key}' references unknown schema '${val.type}'`,
        );
      }
    }
  }

  if (isAgenticStep(step)) {
    if (!step.instruction || typeof step.instruction !== "string") {
      errors.push(`${stepLabel} (agentic) must have an 'instruction'`);
    }
    if (!step.required_output) {
      errors.push(`${stepLabel} (agentic) must have 'required_output'`);
    } else if (!schemaNames.has(step.required_output)) {
      errors.push(
        `${stepLabel} required_output references unknown schema '${step.required_output}'`,
      );
    }
    return;
  }

  if (isProgrammaticStep(step)) {
    if (!Array.isArray(step.actions) || step.actions.length === 0) {
      errors.push(`${stepLabel} (programmatic) must have at least one action`);
      return;
    }
    for (let i = 0; i < step.actions.length; i++) {
      const a = step.actions[i];
      const loc = `${stepLabel} action[${i}]`;
      if (!a.name || typeof a.name !== "string" || a.name.trim() === "") {
        errors.push(`${loc} must have a non-empty 'name'`);
      }
      if (!a.description || typeof a.description !== "string" || a.description.trim() === "") {
        errors.push(`${loc} must have a non-empty 'description'`);
      }
      const hasJs = typeof a.js === "string" && a.js.trim() !== "";
      const hasShell = typeof a.shell === "string" && a.shell.trim() !== "";
      if (!hasJs && !hasShell) {
        errors.push(`${loc} must have exactly one of 'js' or 'shell'`);
      } else if (hasJs && hasShell) {
        errors.push(`${loc} must have exactly one of 'js' or 'shell' (got both)`);
      }
      if (hasJs && a.extract) {
        errors.push(`${loc} 'js' action cannot use 'extract' (use return value)`);
      }
      if (hasJs && /lrail\.(get|set|goto)\s*\(/.test(a.js!)) {
        errors.push(
          `${loc} v1 actions must not use lrail.get/set/goto (use return and context_in instead)`,
        );
      }
    }
    if (step.required_output && !schemaNames.has(step.required_output)) {
      errors.push(
        `${stepLabel} required_output references unknown schema '${step.required_output}'`,
      );
    }
    return;
  }

  if (isRouterStep(step)) {
    if (!Array.isArray(step.cases)) {
      errors.push(`${stepLabel} (router) must have a 'cases' array (use [] for unconditional default)`);
    } else {
      step.cases.forEach((c, i) => {
        const loc = `${stepLabel} case[${i}]`;
        if (!c.when) errors.push(`${loc} must have 'when'`);
        if (!c.goto || typeof c.goto !== "string") {
          errors.push(`${loc} must have 'goto' (target step id)`);
        } else if (!stepIds.has(c.goto)) {
          errors.push(`${loc} goto references unknown step '${c.goto}'`);
        }
      });
    }
    if (!step.default || typeof step.default !== "string") {
      errors.push(`${stepLabel} (router) must have 'default' (no implicit fallthrough)`);
    } else if (!stepIds.has(step.default)) {
      errors.push(
        `${stepLabel} default references unknown step '${step.default}'`,
      );
    }
    if (step.max_iterations !== undefined) {
      if (!Number.isInteger(step.max_iterations) || step.max_iterations < 1) {
        errors.push(`${stepLabel} max_iterations must be a positive integer`);
      }
    }
    return;
  }

  if (isCallStep(step)) {
    if (!step.workflow || typeof step.workflow !== "string") {
      errors.push(`${stepLabel} (call) must have 'workflow' (target name)`);
    }
    if (!step.inputs || typeof step.inputs !== "object") {
      errors.push(`${stepLabel} (call) must have 'inputs' (mapping)`);
    } else {
      for (const [k, v] of Object.entries(step.inputs)) {
        if (typeof v !== "string") {
          errors.push(
            `${stepLabel} inputs.${k} must be a reference string (complex expressions belong in a prior programmatic step)`,
          );
          continue;
        }
        validateContextRef(stepLabel, `inputs.${k}`, v, stepIds, errors);
      }
    }
    return;
  }

  errors.push(`${stepLabel} has unknown type '${(step as { type: string }).type}'`);
}

/**
 * Validate that a context_in / inputs value of the form
 *   "{stepId.field}"       → refers to an existing step
 *   "{{inputName}}"        → refers to workflow input (not checked here;
 *                             IO compatibility is a compile concern)
 * rejects malformed templates.
 */
function validateContextRef(
  stepLabel: string,
  key: string,
  tmpl: string,
  stepIds: Set<string>,
  errors: string[],
): void {
  if (typeof tmpl !== "string" || tmpl.length === 0) {
    errors.push(`${stepLabel} '${key}' must be a non-empty reference string`);
    return;
  }
  const stepRef = tmpl.match(/^\{([\w-]+)\.[\w.-]+\}$/);
  if (stepRef) {
    if (!stepIds.has(stepRef[1])) {
      errors.push(
        `${stepLabel} '${key}' references unknown step '${stepRef[1]}'`,
      );
    }
    return;
  }
  const paramRef = tmpl.match(/^\{\{[\w.-]+\}\}$/);
  if (paramRef) return; // workflow input reference, deferred to compile
  errors.push(
    `${stepLabel} '${key}' has malformed reference '${tmpl}' (expected "{step.field}" or "{{param}}")`,
  );
}
