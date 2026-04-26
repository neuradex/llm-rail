import { loadWorkflow } from "../engine/workflow.js";
import { formatStatus } from "../engine/output.js";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { formatV1Status } from "../engine/output-v1.js";

export function runStatus(id: string): void {
  const loaded = loadInstanceAny(id);
  if (loaded.kind === "v1") {
    const def = loadWorkflowV1(loaded.state.workflow_name);
    console.log(formatV1Status(def, loaded.state));
    return;
  }
  const def = loadWorkflow(loaded.state.workflow_name, loaded.state.variant);
  console.log(formatStatus(def, loaded.state));
}
