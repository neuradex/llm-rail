import { saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { collectDownstream } from "../engine/dependency.js";
import { appendLog } from "../audit/logger.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { saveV1Instance, type V1InstanceState } from "../engine/state-v1.js";

export function runReset(id: string, stepId: string): void {
  const loaded = loadInstanceAny(id);
  if (loaded.kind === "v1") {
    runResetV1(loaded.state, stepId);
    return;
  }

  const state = loaded.state;
  const def = loadWorkflow(state.workflow_name, state.variant);

  const stepIndex = def.steps.findIndex((s) => s.id === stepId);
  if (stepIndex === -1) {
    console.error(`Step '${stepId}' not found in workflow.`);
    process.exit(1);
  }

  if (!state.steps[stepId]) {
    console.error(`Step '${stepId}' not found in instance state.`);
    process.exit(1);
  }

  const downstream = collectDownstream(def, stepId);
  const allToReset = [stepId, ...downstream];

  const resetSteps: string[] = [];

  for (const sid of allToReset) {
    const ss = state.steps[sid];
    if (!ss) continue;
    if (ss.output) {
      for (const key of Object.keys(ss.output)) {
        delete state.context[key];
      }
    }
    ss.status = "pending";
    ss.output = undefined;
    ss.completed_at = undefined;
    resetSteps.push(sid);
  }

  if (state.status === "completed" || state.status === "error") {
    state.status = "in_progress";
  }

  saveInstance(state);

  for (const sid of resetSteps) {
    appendLog(state.workflow_name, state.id, "step_reset", sid);
    fireHook(makeHookPayload("step:reset", state.id, state.workflow_name, sid));
  }

  console.log(`Reset: ${stepId} → pending (output cleared)`);
  if (downstream.length > 0) {
    console.log(`Cascade: ${downstream.join(", ")} → pending (output cleared)`);
  }
}

// ── v1 ──

/**
 * Reset a v1 step. The cascade target is "every step at or after the
 * named step in workflow order" — same shape as router's backward-goto
 * reset window. Active calls are aborted (parent's call step + its
 * descendants reset; the in-flight child is dropped).
 */
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

  // Drop any in-flight call on this branch.
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
