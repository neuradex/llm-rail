import { listInstances } from "../engine/state.js";
import type { InstanceStatus } from "../types.js";

export function runList(statusFilter?: string): void {
  const instances = listInstances();

  const filtered = statusFilter
    ? instances.filter((i) => i.status === statusFilter)
    : instances;

  if (filtered.length === 0) {
    console.log("No instances found.");
    return;
  }

  // Sort by created_at descending
  filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));

  for (const inst of filtered) {
    const stepCount = Object.keys(inst.steps).length;
    const completedCount = Object.values(inst.steps).filter((s) => s.status === "completed").length;
    console.log(
      `${inst.id}  ${inst.workflow_name}  ${inst.status}  (${completedCount}/${stepCount} steps)`,
    );
  }
}
