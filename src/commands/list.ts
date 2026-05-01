import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePackageDir } from "../util.js";
import { listV1Instances } from "../engine/state-v1.js";
import { loadWorkflowAny } from "../engine/workflow-any.js";

interface WorkflowEntry {
  name: string;
  source: "user" | "builtin";
}

function scanWorkflowDir(dirPath: string, opts: { allowSingleFile?: boolean } = {}): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const names: string[] = [];
  const allowSingleFile = opts.allowSingleFile ?? true;

  if (allowSingleFile) {
    for (const f of fs.readdirSync(dirPath)) {
      if (f.endsWith(".yml") || f.endsWith(".yaml")) {
        names.push(f.replace(/\.ya?ml$/, ""));
      }
    }
  }

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

  // builtins/ holds only templates and (eventually) v1 builtin workflows.
  // Single-file YAMLs there (e.g. lrail.default.yml) are configuration
  // templates, not workflows.
  const builtinsDir = resolvePackageDir("builtins");
  for (const name of scanWorkflowDir(builtinsDir, { allowSingleFile: false })) {
    entries.set(name, { name, source: "builtin" });
  }

  const workflowDir = path.resolve("workflows");
  for (const name of scanWorkflowDir(workflowDir)) {
    entries.set(name, { name, source: "user" });
  }

  if (entries.size === 0) {
    console.log("No workflows found.");
    return;
  }

  const allInstances = listV1Instances();

  console.log("Workflows:");
  for (const { name, source } of [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const instances = allInstances.filter((i) => i.workflow_name === name);
    let phase = "draft";
    let formatTag = "";
    try {
      const { def } = loadWorkflowAny(name);
      phase = def.phase || "draft";
      formatTag = " [v1]";
    } catch {
      formatTag = " [legacy — run `lrail wf migrate`]";
    }
    const tag = source === "builtin" ? "[builtin]" : `[${phase}]`;
    const parts = [`  ${name}`, tag + formatTag];
    if (instances.length > 0) parts.push(`(${instances.length} instances)`);
    console.log(parts.join("  "));
  }
}

export function runListInstances(statusFilter?: string): void {
  let instances = listV1Instances();
  if (statusFilter) {
    instances = instances.filter((i) => i.status === statusFilter);
  }
  if (instances.length === 0) {
    console.log("No instances found.");
    return;
  }
  instances.sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const inst of instances) {
    const stepCount = Object.keys(inst.steps).length;
    const completedCount = Object.values(inst.steps).filter((s) => s.status === "completed").length;
    const label = inst.alias ? `${inst.alias} (${inst.id})` : inst.id;
    console.log(
      `${label}  ${inst.workflow_name}  ${inst.status}  (${completedCount}/${stepCount} steps)`,
    );
  }
}

export function runList(workflowName: string, statusFilter?: string): void {
  let instances = listV1Instances().filter((i) => i.workflow_name === workflowName);
  if (statusFilter) {
    instances = instances.filter((i) => i.status === statusFilter);
  }
  if (instances.length === 0) {
    console.log(`No instances found for workflow '${workflowName}'.`);
    return;
  }
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
