import type { WorkflowDef } from "../types.js";

/**
 * Collect all steps after stepId in array order (for reset cascade).
 * With goto-based flow control, "downstream" simply means
 * all steps that come after the given step in the array.
 */
export function collectDownstream(def: WorkflowDef, stepId: string): string[] {
  const index = def.steps.findIndex((s) => s.id === stepId);
  if (index === -1) return [];
  return def.steps.slice(index + 1).map((s) => s.id);
}
