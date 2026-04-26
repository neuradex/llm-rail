import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { formatV1Status } from "../engine/output-v1.js";

export function runStatus(id: string): void {
  const { state } = loadInstanceAny(id);
  const def = loadWorkflowV1(state.workflow_name);
  console.log(formatV1Status(def, state));
}
