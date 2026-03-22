import { loadInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { formatStatus } from "../engine/output.js";

export function runStatus(id: string): void {
  const state = loadInstance(id);
  const def = loadWorkflow(state.workflow_name, state.variant);
  console.log(formatStatus(def, state));
}
