import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { resolveWorkflowPath, loadVariant, mergeVariant } from "../engine/variant.js";
import { validateWorkflowDef } from "../engine/workflow.js";
import { loadYaml } from "../util.js";
import type { WorkflowDef } from "../types.js";

export function runMerge(workflowName: string, variantName: string, backup?: string): void {
  const { basePath, isDirectory } = resolveWorkflowPath(workflowName);

  if (!isDirectory) {
    console.error("Merge requires directory format: workflows/<name>/workflow.yml");
    console.error(`Current format is single-file: ${basePath}`);
    process.exit(1);
  }

  const base = loadYaml<WorkflowDef>(basePath);
  const variantDef = loadVariant(workflowName, variantName);
  const merged = mergeVariant(base, variantDef);

  // Validate merged result
  const errors = validateWorkflowDef(merged);
  if (errors.length > 0) {
    console.error("Merged workflow has validation errors:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // Backup current workflow.yml if requested
  if (backup) {
    const backupPath = path.resolve("workflows", workflowName, `${backup}.workflow.yml`);
    fs.copyFileSync(basePath, backupPath);
    console.log(`Backed up current workflow.yml → ${backup}.workflow.yml`);
  }

  // Write merged result
  const content = yaml.dump(merged, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(basePath, content, "utf-8");

  console.log(`Merged variant '${variantName}' into workflow.yml`);
  console.log(`  Steps: ${merged.steps.length}`);
  console.log(`  Phase: ${merged.phase || "draft"}`);
}
