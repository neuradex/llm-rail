import * as fs from "node:fs";
import * as path from "node:path";
import { listInstances } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { listVariants } from "../engine/variant.js";

/**
 * List all available workflows (scans workflows/ directory).
 * Supports both single-file (workflows/name.yml) and directory (workflows/name/workflow.yml) formats.
 */
export function runListWorkflows(): void {
  const workflowDir = path.resolve("workflows");

  if (!fs.existsSync(workflowDir)) {
    console.log("No workflows/ directory found.");
    return;
  }

  const names = new Set<string>();

  // Single-file workflows: workflows/*.yml
  const files = fs.readdirSync(workflowDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  for (const file of files) {
    names.add(file.replace(/\.ya?ml$/, ""));
  }

  // Directory workflows: workflows/*/workflow.yml
  for (const entry of fs.readdirSync(workflowDir)) {
    const entryPath = path.resolve(workflowDir, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;
    if (fs.existsSync(path.resolve(entryPath, "workflow.yml"))) {
      names.add(entry);
    }
  }

  if (names.size === 0) {
    console.log("No workflows found.");
    return;
  }

  const allInstances = listInstances();

  console.log("Workflows:");
  for (const name of [...names].sort()) {
    const instances = allInstances.filter((i) => i.workflow_name === name);
    let phase = "draft";
    try {
      const def = loadWorkflow(name);
      phase = def.phase || "draft";
    } catch { /* skip */ }
    const parts = [`  ${name}`, `[${phase}]`];
    const variants = listVariants(name);
    if (variants.length > 0) parts.push(`(${variants.length} variants)`);
    if (instances.length > 0) parts.push(`(${instances.length} instances)`);
    console.log(parts.join("  "));
  }
}

/**
 * List instances for a specific workflow.
 */
export function runList(workflowName: string, statusFilter?: string): void {
  let instances = listInstances();

  // Filter by workflow name
  instances = instances.filter((i) => i.workflow_name === workflowName);

  if (statusFilter) {
    instances = instances.filter((i) => i.status === statusFilter);
  }

  if (instances.length === 0) {
    console.log(`No instances found for workflow '${workflowName}'.`);
    return;
  }

  // Sort by created_at descending
  instances.sort((a, b) => b.created_at.localeCompare(a.created_at));

  for (const inst of instances) {
    const stepCount = Object.keys(inst.steps).length;
    const completedCount = Object.values(inst.steps).filter((s) => s.status === "completed").length;
    const label = inst.alias ? `${inst.alias} (${inst.id})` : inst.id;
    console.log(
      `${label}  ${inst.status}  (${completedCount}/${stepCount} steps)`,
    );
  }
}
