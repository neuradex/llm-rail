import * as fs from "node:fs";
import * as path from "node:path";
import { loadYaml } from "../util.js";
import { isV1Workflow, type WorkflowV1Def } from "../types-v1.js";
import { compileV1Workflow } from "../engine/compile-v1.js";
import { makeInMemoryRegistry, type V1WorkflowRegistry } from "../engine/call-v1.js";
import { resolveWorkflowPath } from "../engine/variant.js";

function loadV1File(filePath: string, hint: string): WorkflowV1Def {
  const loaded = loadYaml<unknown>(path.resolve(filePath));
  if (!isV1Workflow(loaded)) {
    throw new Error(
      `${hint} is not a v1 workflow (missing 'format: v1'). 'lrail wf compile' only supports v1 workflows.`,
    );
  }
  return loaded;
}

/**
 * Build a V1WorkflowRegistry from a directory of YAML files. Non-v1 files
 * and parse errors are silently skipped — this is best-effort resolution,
 * not a strict bundle check.
 */
function buildRegistryFromDir(dir: string): V1WorkflowRegistry {
  const entries: Record<string, WorkflowV1Def> = {};
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return makeInMemoryRegistry(entries);

  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.ya?ml$/.test(name)) continue;
      try {
        const loaded = loadYaml<unknown>(p);
        if (isV1Workflow(loaded) && typeof loaded.name === "string") {
          entries[loaded.name] = loaded;
        }
      } catch {
        /* skip unreadable / invalid YAML */
      }
    }
  };
  walk(dir);
  return makeInMemoryRegistry(entries);
}

export interface RunCompileOptions {
  workflowName?: string;
  filePath?: string;
  registryDir?: string;
}

export function runCompile(opts: RunCompileOptions): void {
  let def: WorkflowV1Def;
  let source: string;

  if (opts.filePath) {
    source = path.resolve(opts.filePath);
    def = loadV1File(opts.filePath, source);
  } else if (opts.workflowName) {
    const { basePath } = resolveWorkflowPath(opts.workflowName);
    source = basePath;
    def = loadV1File(basePath, `Workflow '${opts.workflowName}' at ${basePath}`);
  } else {
    console.error("Usage: lrail wf <name> compile [--path <file>] [--registry <dir>]");
    process.exit(1);
  }

  const registry = opts.registryDir
    ? buildRegistryFromDir(opts.registryDir)
    : undefined;

  const result = compileV1Workflow(def, registry);

  const label = `'${def.name}' (${source})`;

  if (result.info.length > 0) {
    console.log("Info:");
    for (const i of result.info) console.log(`  - ${i}`);
  }
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
  if (result.errors.length > 0) {
    console.error("Errors:");
    for (const e of result.errors) console.error(`  - ${e}`);
    console.error(`\nWorkflow ${label} failed to compile.`);
    process.exit(1);
  }

  console.log(`Workflow ${label} compiled successfully.`);
  console.log(`  Steps: ${def.steps.length}`);
  const counts = { agentic: 0, programmatic: 0, router: 0, call: 0 };
  for (const s of def.steps) counts[s.type]++;
  console.log(
    `  Types: ${counts.agentic} agentic, ${counts.programmatic} programmatic, ${counts.router} router, ${counts.call} call`,
  );
  if (result.warnings.length > 0) {
    console.log(`  Warnings: ${result.warnings.length}`);
  }
}
