import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkflowDef, StepDef } from "../types.js";
import { loadYaml } from "../util.js";
import { resolveWorkflowPath, loadVariant, mergeVariant } from "./variant.js";

export function loadWorkflowFromPath(filePath: string): WorkflowDef {
  return loadYaml<WorkflowDef>(path.resolve(filePath));
}

export function loadWorkflow(name: string, variant?: string): WorkflowDef {
  const { basePath } = resolveWorkflowPath(name);
  const base = loadYaml<WorkflowDef>(basePath);

  if (variant) {
    const variantDef = loadVariant(name, variant);
    return mergeVariant(base, variantDef);
  }

  return base;
}

/** Normalize depends_on to always be an array */
export function normalizeDeps(dep?: string | string[]): string[] {
  if (!dep) return [];
  return Array.isArray(dep) ? dep : [dep];
}

const RESERVED_NAMES = new Set([
  "list", "learn", "help", "version",
]);

export function validateWorkflowDef(def: WorkflowDef): string[] {
  const errors: string[] = [];

  if (!def.name) errors.push("Workflow must have a name");
  if (def.name && RESERVED_NAMES.has(def.name)) {
    errors.push(`Workflow name '${def.name}' is reserved and cannot be used`);
  }
  if (def.name && /^\d{4}-\d{6}$/.test(def.name)) {
    errors.push(`Workflow name '${def.name}' looks like an instance ID and cannot be used`);
  }

  // Phase validation
  const phase = def.phase || "draft";
  if (def.phase && !["draft", "dev", "stable"].includes(def.phase)) {
    errors.push(`Invalid phase '${def.phase}'. Must be 'draft', 'dev', or 'stable'`);
  }
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    errors.push("Workflow must have at least one step");
    return errors;
  }

  const ids = new Set<string>();
  for (const step of def.steps) {
    if (!step.id) {
      errors.push("Each step must have an id");
      continue;
    }
    if (ids.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}`);
    }
    ids.add(step.id);

    const stepType = step.type || "agentic";

    // Validate accumulate config
    if (step.accumulate) {
      if (stepType === "programmatic") {
        errors.push(`Programmatic step '${step.id}' cannot use accumulate`);
      }
      for (const [field, config] of Object.entries(step.accumulate)) {
        if (!config.key) {
          errors.push(`Step '${step.id}' accumulate field '${field}' must have a 'key' for deduplication`);
        }
      }
    }

    if (stepType === "programmatic") {
      // programmatic: actions required, description/required_output optional
      if (!Array.isArray(step.actions) || step.actions.length === 0) {
        errors.push(`Programmatic step '${step.id}' must have at least one action`);
      } else {
        for (let i = 0; i < step.actions.length; i++) {
          const a = step.actions[i] as unknown as Record<string, unknown>;
          const hasJs = typeof a.js === "string" && a.js.trim() !== "";
          const hasShell = typeof a.shell === "string" && a.shell.trim() !== "";

          if (!hasJs && !hasShell) {
            errors.push(`Step '${step.id}' action[${i}] must have a non-empty 'js' or 'shell'`);
          }
          if (hasJs && hasShell) {
            errors.push(`Step '${step.id}' action[${i}] must have exactly one of 'js' or 'shell'`);
          }
          if (hasJs && a.extract) {
            errors.push(`Step '${step.id}' action[${i}] 'js' action does not use 'extract' — use return instead`);
          }
        }
      }
    } else {
      // agentic: instruction + required_output required, description optional
      if (!step.instruction) {
        errors.push(`Step '${step.id}' must have an instruction`);
      }
      if (!Array.isArray(step.required_output) || step.required_output.length === 0) {
        errors.push(`Step '${step.id}' must have at least one required_output`);
      }
    }
  }

  // Validate policy
  if (def.policy) {
    if (def.policy.mode !== "trail" && def.policy.mode !== "enforce") {
      errors.push(`Policy mode must be 'trail' or 'enforce'`);
    }
    if (def.policy.mode === "enforce" && (!Array.isArray(def.policy.rules) || def.policy.rules.length === 0)) {
      errors.push(`Policy in enforce mode must have at least one rule`);
    }
  }

  // depends_on reference check (supports string | string[])
  for (const step of def.steps) {
    const deps = normalizeDeps(step.depends_on);
    for (const dep of deps) {
      if (!ids.has(dep)) {
        errors.push(`Step '${step.id}' depends_on unknown step '${dep}'`);
      }
    }
  }

  // context_in reference check
  for (const step of def.steps) {
    if (!step.context_in) continue;
    for (const [key, tmpl] of Object.entries(step.context_in)) {
      const stepRef = tmpl.match(/^\{(\w+)\.\w+\}$/);
      if (stepRef && !ids.has(stepRef[1])) {
        errors.push(`Step '${step.id}' context_in '${key}' references unknown step '${stepRef[1]}'`);
      }
    }
  }

  // params validation
  if (def.params) {
    for (const [name, paramDef] of Object.entries(def.params)) {
      if (!["string", "number", "boolean"].includes(paramDef.type)) {
        errors.push(`Param '${name}' has invalid type '${paramDef.type}'`);
      }
    }
  }

  // Phase-specific constraints
  if (phase === "stable") {
    if (!def.policy || def.policy.mode !== "enforce") {
      errors.push(`Stable workflow must have policy mode 'enforce'`);
    }
  }

  // cycle detection (multi-dep)
  const cycleErrors = detectCycles(def.steps);
  errors.push(...cycleErrors);

  return errors;
}

function detectCycles(steps: StepDef[]): string[] {
  // Build adjacency: step → its dependencies
  const graph = new Map<string, string[]>();
  for (const step of steps) {
    graph.set(step.id, normalizeDeps(step.depends_on));
  }

  const visited = new Set<string>();
  const errors: string[] = [];

  for (const step of steps) {
    if (visited.has(step.id)) continue;
    const pathSet = new Set<string>();
    const stack = [step.id];

    while (stack.length > 0) {
      const current = stack[stack.length - 1];

      if (pathSet.has(current)) {
        // We're revisiting — pop
        pathSet.delete(current);
        visited.add(current);
        stack.pop();
        continue;
      }

      if (visited.has(current)) {
        stack.pop();
        continue;
      }

      pathSet.add(current);
      const deps = graph.get(current) || [];
      for (const dep of deps) {
        if (pathSet.has(dep)) {
          errors.push(`Cycle detected involving step '${dep}'`);
        } else if (!visited.has(dep)) {
          stack.push(dep);
        }
      }
    }
  }

  return errors;
}
