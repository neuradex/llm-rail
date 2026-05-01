import {
  isAgenticStep,
  isCallStep,
  isProgrammaticStep,
  isRouterStep,
  type ContextInValue,
  type SchemaDef,
  type V1StepDef,
  type WorkflowV1Def,
} from "../types-v1.js";
import type { V1WorkflowRegistry } from "./call-v1.js";
import { buildSchemaRegistry } from "./schemas.js";
import { validateWorkflowV1Def } from "./workflow-v1.js";

// ── Result ──

/**
 * Compile-time diagnostic. Severity is separated so a tool can fail the
 * build on `errors` while still surfacing `warnings` and `info`.
 */
export interface CompileResult {
  errors: string[];
  warnings: string[];
  info: string[];
}

// ── Public API ──

/**
 * Statically validate a v1 workflow definition beyond structural parsing.
 *
 * Checks in order:
 *   1. Structure (delegates to validateWorkflowV1Def) — errors only.
 *   2. Schema cycles — reported as info (cycles are allowed for recursive
 *      data, but flagged so the author knows they exist).
 *   3. context_in execution order — source step should precede target in
 *      the workflow's step array, unless a default covers the pending
 *      case (e.g. forward-goto skip, recursive base case). Violations
 *      surface as warnings since router goto can, in theory, visit a
 *      later step before an earlier one.
 *   4. Router semantics — a router with any backward goto (target at or
 *      before the router's own position) must declare max_iterations.
 *   5. Call recursion — a workflow that calls itself (directly or, when
 *      the registry permits, transitively) must declare max_depth.
 *   6. Call IO compatibility (only if `registry` is provided) — inputs
 *      must cover the child's required input fields; the caller's
 *      downstream references to `{call.field}` must match the child's
 *      output schema.
 */
export function compileV1Workflow(
  def: WorkflowV1Def,
  registry?: V1WorkflowRegistry,
): CompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  // 1. Structure
  const structureErrors = validateWorkflowV1Def(def);
  errors.push(...structureErrors);
  if (structureErrors.length > 0) {
    // Don't run deeper semantic checks on a definition that failed basic
    // structure; further analysis would emit a blizzard of derivative
    // errors. Caller can still see structure problems and fix them first.
    return { errors, warnings, info };
  }

  // 2. Schema cycles
  const { cycles } = buildSchemaRegistry(def.schemas);
  for (const cycle of cycles) {
    info.push(`Schema cycle: ${cycle.join(" → ")}`);
  }

  // 3. context_in execution order
  checkContextOrder(def, warnings);

  // 4. Router max_iterations
  checkRouterMaxIterations(def, errors);

  // 5. Call recursion max_depth
  checkCallRecursion(def, registry, errors);

  // 6. Cross-workflow IO
  if (registry) {
    checkCallIOCompatibility(def, registry, errors, warnings);
  }

  return { errors, warnings, info };
}

// ── context_in execution order ──

function stepIndex(def: WorkflowV1Def): Map<string, number> {
  const m = new Map<string, number>();
  def.steps.forEach((s, i) => m.set(s.id, i));
  return m;
}

function contextInOf(step: V1StepDef): Record<string, ContextInValue> | undefined {
  if (isAgenticStep(step) || isProgrammaticStep(step) || isRouterStep(step)) {
    return step.context_in;
  }
  return undefined;
}

function checkContextOrder(def: WorkflowV1Def, warnings: string[]): void {
  const index = stepIndex(def);

  for (const step of def.steps) {
    const ctx = contextInOf(step);
    if (!ctx) continue;
    const myIdx = index.get(step.id)!;

    for (const [key, value] of Object.entries(ctx)) {
      const template = typeof value === "string" ? value : value.from;
      const hasDefault = typeof value !== "string" && "default" in value;
      const stepRef = template.match(/^\{([\w-]+)\.[\w.-]+\}$/);
      if (!stepRef) continue; // workflow input refs handled elsewhere
      const [, sourceStep] = stepRef;
      const srcIdx = index.get(sourceStep);
      if (srcIdx === undefined) continue; // already caught by structure check
      if (srcIdx >= myIdx && !hasDefault) {
        warnings.push(
          `Step '${step.id}' context_in '${key}' references '${sourceStep}' which is at or after '${step.id}' in the step order — may read a pending step unless reached via router goto. Consider adding a default.`,
        );
      }
    }
  }

  // call inputs referencing later steps have the same shape.
  for (const step of def.steps) {
    if (!isCallStep(step)) continue;
    const myIdx = index.get(step.id)!;
    for (const [key, tmpl] of Object.entries(step.inputs)) {
      const stepRef = tmpl.match(/^\{([\w-]+)\.[\w.-]+\}$/);
      if (!stepRef) continue;
      const [, sourceStep] = stepRef;
      const srcIdx = index.get(sourceStep);
      if (srcIdx === undefined) continue;
      if (srcIdx >= myIdx) {
        warnings.push(
          `Call step '${step.id}' inputs.${key} references '${sourceStep}' which is at or after '${step.id}' in the step order — may read a pending step.`,
        );
      }
    }
  }
}

// ── Router semantics ──

function checkRouterMaxIterations(def: WorkflowV1Def, errors: string[]): void {
  const index = stepIndex(def);

  for (const step of def.steps) {
    if (!isRouterStep(step)) continue;
    const myIdx = index.get(step.id)!;

    const gotoTargets = [
      step.default,
      ...step.cases.map((c) => c.goto),
    ].filter((t): t is string => typeof t === "string");

    const hasBackward = gotoTargets.some((t) => {
      const i = index.get(t);
      return i !== undefined && i <= myIdx;
    });

    if (hasBackward && step.max_iterations === undefined) {
      errors.push(
        `Router '${step.id}' has backward goto(s) but no 'max_iterations' — infinite loops must be bounded.`,
      );
    }
  }
}

// ── Call recursion ──

function checkCallRecursion(
  def: WorkflowV1Def,
  registry: V1WorkflowRegistry | undefined,
  errors: string[],
): void {
  // Direct self-recursion: any call step whose workflow name matches def.name.
  const selfCalls = def.steps.filter(
    (s): s is Extract<V1StepDef, { type: "call" }> =>
      isCallStep(s) && s.workflow === def.name,
  );
  if (selfCalls.length > 0 && def.max_depth === undefined) {
    errors.push(
      `Workflow '${def.name}' calls itself (step${selfCalls.length > 1 ? "s" : ""} ${selfCalls
        .map((s) => `'${s.id}'`)
        .join(", ")}) but declares no 'max_depth' — recursion must be bounded.`,
    );
  }

  // Transitive recursion via the registry: if this workflow can reach itself
  // through a call cycle, it must also declare max_depth.
  if (registry) {
    if (canReachSelfTransitively(def, registry) && def.max_depth === undefined) {
      errors.push(
        `Workflow '${def.name}' participates in a call cycle (transitive recursion) but declares no 'max_depth'.`,
      );
    }
  }
}

function canReachSelfTransitively(
  root: WorkflowV1Def,
  registry: V1WorkflowRegistry,
): boolean {
  const visited = new Set<string>([root.name]);
  const queue: string[] = [];

  // Seed with all immediate call targets other than self (self is handled
  // by the direct check above).
  for (const step of root.steps) {
    if (isCallStep(step) && step.workflow !== root.name) {
      queue.push(step.workflow);
    }
  }

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (name === root.name) return true;
    if (visited.has(name)) continue;
    visited.add(name);

    const childDef = registry.load(name);
    if (!childDef) continue;
    for (const step of childDef.steps) {
      if (isCallStep(step)) {
        queue.push(step.workflow);
      }
    }
  }
  return false;
}

// ── Cross-workflow IO compatibility ──

function checkCallIOCompatibility(
  def: WorkflowV1Def,
  registry: V1WorkflowRegistry,
  errors: string[],
  warnings: string[],
): void {
  for (const step of def.steps) {
    if (!isCallStep(step)) continue;
    const childDef = registry.load(step.workflow);
    if (!childDef) {
      // Self-recursion: step.workflow === def.name — skip (child is self,
      // no registry load needed).
      if (step.workflow === def.name) continue;
      errors.push(
        `Call step '${step.id}' references workflow '${step.workflow}' not found in registry`,
      );
      continue;
    }

    // Inputs: every required key of child's input schema must be mapped;
    // unknown keys in step.inputs are a warning (they're silently dropped
    // at runtime).
    const childInputSchema = resolveSchema(childDef, childDef.input);
    if (childInputSchema) {
      const required = new Set(childInputSchema.required ?? []);
      const knownProps = new Set(Object.keys(childInputSchema.properties ?? {}));
      for (const req of required) {
        if (!(req in step.inputs)) {
          errors.push(
            `Call '${step.id}' missing required input '${req}' for '${step.workflow}'`,
          );
        }
      }
      for (const provided of Object.keys(step.inputs)) {
        if (knownProps.size > 0 && !knownProps.has(provided)) {
          warnings.push(
            `Call '${step.id}' inputs.${provided} is not declared in '${step.workflow}' input schema`,
          );
        }
      }
    }

    // Outputs: any reference to {step.id.field} elsewhere must name a
    // property of child's output schema.
    const childOutputSchema = resolveSchema(childDef, childDef.output);
    if (childOutputSchema?.properties) {
      const known = new Set(Object.keys(childOutputSchema.properties));
      for (const ref of findRefsToStep(def, step.id)) {
        if (!known.has(ref.field)) {
          warnings.push(
            `Step '${ref.consumer}' context_in '${ref.key}' references '{${step.id}.${ref.field}}' but '${ref.field}' is not declared in '${step.workflow}' output schema`,
          );
        }
      }
    }
  }
}

function resolveSchema(
  def: WorkflowV1Def,
  nameOrInline: string | SchemaDef,
): SchemaDef | undefined {
  if (typeof nameOrInline === "string") {
    return def.schemas[nameOrInline];
  }
  return nameOrInline;
}

interface StepRef {
  consumer: string;
  key: string;
  field: string;
}

function findRefsToStep(def: WorkflowV1Def, targetStepId: string): StepRef[] {
  const out: StepRef[] = [];
  const pattern = new RegExp(`^\\{${escapeRegex(targetStepId)}\\.([\\w.-]+)\\}$`);

  for (const step of def.steps) {
    const ctx = contextInOf(step);
    if (ctx) {
      for (const [key, value] of Object.entries(ctx)) {
        const tmpl = typeof value === "string" ? value : value.from;
        const m = tmpl.match(pattern);
        if (m) {
          out.push({ consumer: step.id, key, field: m[1].split(".")[0] });
        }
      }
    }
    if (isCallStep(step)) {
      for (const [key, tmpl] of Object.entries(step.inputs)) {
        const m = tmpl.match(pattern);
        if (m) {
          out.push({ consumer: step.id, key: `inputs.${key}`, field: m[1].split(".")[0] });
        }
      }
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
