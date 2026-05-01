import * as path from "node:path";
import { loadYaml } from "../util.js";
import { isV1Workflow, type WorkflowV1Def } from "../types-v1.js";
import { exportGraph } from "../engine/graph-v1.js";
import { resolveWorkflowPath } from "../engine/variant.js";

export interface RunGraphOptions {
  workflowName?: string;
  filePath?: string;
  /** Reserved for future output formats (mermaid, dot). --json is default. */
  format?: "json";
}

function loadV1(filePath: string, hint: string): WorkflowV1Def {
  const loaded = loadYaml<unknown>(path.resolve(filePath));
  if (!isV1Workflow(loaded)) {
    throw new Error(
      `${hint} is not a v1 workflow (missing 'format: v1'). 'lrail wf graph' is v1-only.`,
    );
  }
  return loaded;
}

export function runGraph(opts: RunGraphOptions): void {
  let def: WorkflowV1Def;

  if (opts.filePath) {
    def = loadV1(opts.filePath, path.resolve(opts.filePath));
  } else if (opts.workflowName) {
    const { basePath } = resolveWorkflowPath(opts.workflowName);
    def = loadV1(basePath, `Workflow '${opts.workflowName}' at ${basePath}`);
  } else {
    console.error("Usage: lrail wf <name> graph --json [--path <file>]");
    process.exit(1);
  }

  const graph = exportGraph(def);
  process.stdout.write(JSON.stringify(graph, null, 2) + "\n");
}
