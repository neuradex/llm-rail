import { loadWorkflow, validateWorkflowDef } from "../engine/workflow.js";
import { createInstance } from "../engine/state.js";
import { appendLog } from "../audit/logger.js";

export function runCreate(workflowName: string): void {
  const def = loadWorkflow(workflowName);

  const errors = validateWorkflowDef(def);
  if (errors.length > 0) {
    console.error("Workflow definition errors:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const state = createInstance(def);
  appendLog(state.id, "created", undefined, { workflow_name: def.name });

  console.log(state.id);
}
