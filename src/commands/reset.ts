import { appendLog } from "../audit/logger.js";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { saveV1Instance, type V1InstanceState } from "../engine/state-v1.js";

/**
 * Reset a v1 step. The cascade window is [target, end-of-workflow]
 * (matching router backward-goto reset semantics). Drops any in-flight
 * active_call.
 */
export function runReset(id: string, stepId: string): void {
  const { state } = loadInstanceAny(id);
  runResetV1(state, stepId);
}

function runResetV1(state: V1InstanceState, stepId: string): void {
  const def = loadWorkflowV1(state.workflow_name);

  const stepIndex = def.steps.findIndex((s) => s.id === stepId);
  if (stepIndex === -1) {
    console.error(`Step '${stepId}' not found in workflow.`);
    process.exit(1);
  }
  if (!state.steps[stepId]) {
    console.error(`Step '${stepId}' not found in instance state.`);
    process.exit(1);
  }

  const resetIds: string[] = [];
  for (let i = stepIndex; i < def.steps.length; i++) {
    const sid = def.steps[i].id;
    const ss = state.steps[sid];
    if (!ss) continue;
    ss.status = "pending";
    ss.output = undefined;
    ss.completed_at = undefined;
    ss.iterations = 0;
    resetIds.push(sid);
  }

  if (state.active_call) {
    state.active_call = undefined;
  }

  state.current_step_id = stepId;
  if (state.status === "completed" || state.status === "error") {
    state.status = "in_progress";
  }
  state.last_completed_step_id = stepIndex > 0 ? def.steps[stepIndex - 1].id : null;

  saveV1Instance(state);

  for (const sid of resetIds) {
    appendLog(state.workflow_name, state.id, "step_reset", sid);
  }

  console.log(`Reset: ${stepId} → pending (output cleared)`);
  if (resetIds.length > 1) {
    console.log(`Cascade: ${resetIds.slice(1).join(", ")} → pending (output cleared)`);
  }
}
