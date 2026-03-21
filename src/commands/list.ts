import * as fs from "node:fs";
import * as path from "node:path";
import { listInstances } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { listVariants } from "../engine/variant.js";

interface WorkflowEntry {
  name: string;
  source: "user" | "builtin";
}

function resolveBuiltinsDir(): string {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const dir = path.resolve(pluginRoot, "builtins");
    if (fs.existsSync(dir)) return dir;
  }
  const local = path.resolve("builtins");
  if (fs.existsSync(local)) return local;
  return "";
}

function scanWorkflowDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const names: string[] = [];

  // Single-file: *.yml
  for (const f of fs.readdirSync(dirPath)) {
    if (f.endsWith(".yml") || f.endsWith(".yaml")) {
      names.push(f.replace(/\.ya?ml$/, ""));
    }
  }

  // Directory: */workflow.yml
  for (const entry of fs.readdirSync(dirPath)) {
    const entryPath = path.resolve(dirPath, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;
    if (fs.existsSync(path.resolve(entryPath, "workflow.yml"))) {
      if (!names.includes(entry)) names.push(entry);
    }
  }

  return names;
}

/**
 * List all available workflows (user + builtin).
 */
export function runListWorkflows(): void {
  const entries = new Map<string, WorkflowEntry>();

  // Builtins first (user can override)
  const builtinsDir = resolveBuiltinsDir();
  for (const name of scanWorkflowDir(builtinsDir)) {
    entries.set(name, { name, source: "builtin" });
  }

  // User workflows (override builtins)
  const workflowDir = path.resolve("workflows");
  for (const name of scanWorkflowDir(workflowDir)) {
    entries.set(name, { name, source: "user" });
  }

  if (entries.size === 0) {
    console.log("No workflows found.");
    return;
  }

  const allInstances = listInstances();

  console.log("Workflows:");
  for (const { name, source } of [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const instances = allInstances.filter((i) => i.workflow_name === name);
    let phase = "draft";
    try {
      const def = loadWorkflow(name);
      phase = def.phase || "draft";
    } catch { /* skip */ }
    const tag = source === "builtin" ? "[builtin]" : `[${phase}]`;
    const parts = [`  ${name}`, tag];
    const variants = listVariants(name);
    if (variants.length > 0) parts.push(`(${variants.length} variants)`);
    if (instances.length > 0) parts.push(`(${instances.length} instances)`);
    console.log(parts.join("  "));
  }
}

/**
 * List all instances across all workflows.
 */
export function runListInstances(statusFilter?: string): void {
  let instances = listInstances();

  if (statusFilter) {
    instances = instances.filter((i) => i.status === statusFilter);
  }

  if (instances.length === 0) {
    console.log("No instances found.");
    return;
  }

  // Sort by created_at descending
  instances.sort((a, b) => b.created_at.localeCompare(a.created_at));

  for (const inst of instances) {
    const stepCount = Object.keys(inst.steps).length;
    const completedCount = Object.values(inst.steps).filter((s) => s.status === "completed").length;
    const label = inst.alias ? `${inst.alias} (${inst.id})` : inst.id;
    const variant = inst.variant ? ` [${inst.variant}]` : "";
    console.log(
      `${label}  ${inst.workflow_name}${variant}  ${inst.status}  (${completedCount}/${stepCount} steps)`,
    );
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
