import type { WorkflowDef, InstanceState } from "../types.js";
import { normalizeDeps } from "./workflow.js";

/**
 * BFS to collect all downstream dependent steps (for reset cascade).
 */
export function collectDownstream(def: WorkflowDef, stepId: string): string[] {
  // Build reverse map: stepId → steps that depend on it
  const dependents = new Map<string, string[]>();
  for (const step of def.steps) {
    const deps = normalizeDeps(step.depends_on);
    for (const dep of deps) {
      const list = dependents.get(dep) || [];
      list.push(step.id);
      dependents.set(dep, list);
    }
  }

  const downstream: string[] = [];
  const queue = [stepId];
  const visited = new Set<string>([stepId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = dependents.get(current) || [];
    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        downstream.push(child);
        queue.push(child);
      }
    }
  }

  return downstream;
}

/**
 * Check if all dependencies of a step are completed.
 */
export function isReady(
  def: WorkflowDef,
  stepId: string,
  stepStates: InstanceState["steps"],
): boolean {
  const step = def.steps.find((s) => s.id === stepId);
  if (!step) return false;

  const deps = normalizeDeps(step.depends_on);
  return deps.every((dep) => {
    const depState = stepStates[dep];
    return depState && depState.status === "completed";
  });
}
