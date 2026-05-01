import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { migrateLegacyWorkflow } from "../engine/migrate-v1.js";
import { resolveWorkflowPath } from "../engine/variant.js";
import type { WorkflowDef } from "../types.js";
import { isV1Workflow } from "../types-v1.js";
import { loadYaml } from "../util.js";

export interface RunMigrateOptions {
  workflowName?: string;
  filePath?: string;
  outputPath?: string;
  dryRun?: boolean;
}

export function runMigrate(opts: RunMigrateOptions): void {
  // Resolve source path
  let sourcePath: string;
  if (opts.filePath) {
    sourcePath = path.resolve(opts.filePath);
  } else if (opts.workflowName) {
    const { basePath } = resolveWorkflowPath(opts.workflowName);
    sourcePath = basePath;
  } else {
    console.error("Usage: lrail wf <name> migrate [--path <file>] [--output <file>] [--dry-run]");
    process.exit(1);
  }

  // Pre-check: do not migrate a file that's already v1
  const raw = loadYaml<unknown>(sourcePath);
  if (isV1Workflow(raw)) {
    console.error(`${sourcePath} is already a v1 workflow. Nothing to migrate.`);
    process.exit(1);
  }

  const legacy = raw as WorkflowDef;
  const { migrated, todos, notes } = migrateLegacyWorkflow(legacy);

  const outPath =
    opts.outputPath ??
    deriveMigratedPath(sourcePath);

  const body = renderMigratedYaml(migrated, todos);

  if (opts.dryRun) {
    process.stdout.write(body);
  } else {
    if (fs.existsSync(outPath)) {
      console.error(`Refusing to overwrite existing file: ${outPath}`);
      console.error("Pass --output <other> or remove the file first.");
      process.exit(1);
    }
    fs.writeFileSync(outPath, body, "utf-8");
  }

  // Summary
  const lines: string[] = [];
  lines.push(opts.dryRun ? `Migrated (dry-run) from ${sourcePath}` : `Migrated ${sourcePath}`);
  if (!opts.dryRun) lines.push(`  → ${outPath}`);
  for (const n of notes) lines.push(`  ${n}`);
  if (todos.length > 0) {
    lines.push("");
    lines.push(`TODO (${todos.length}):`);
    for (const t of todos) lines.push(`  - ${t}`);
    lines.push("");
    lines.push("Review the migrated file before running. Items above were left as-is and require manual attention.");
  } else {
    lines.push("  No manual follow-up needed.");
  }
  for (const l of lines) (opts.dryRun ? console.error : console.log)(l);
}

function deriveMigratedPath(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}.migrated${parsed.ext}`);
}

function renderMigratedYaml(def: unknown, todos: string[]): string {
  const header: string[] = [
    "# Migrated from legacy format by `lrail wf migrate`.",
    `# Generated on ${new Date().toISOString()}`,
  ];
  if (todos.length > 0) {
    header.push("#");
    header.push(`# TODO (${todos.length}) — review before running:`);
    for (const t of todos) header.push(`#   - ${t}`);
  }
  header.push("");
  return header.join("\n") + yaml.dump(def, { lineWidth: 100, noRefs: true });
}
