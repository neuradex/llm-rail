import { loadInstance, saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { collectDownstream } from "../engine/dependency.js";
import { appendLog } from "../audit/logger.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";

export function runReset(id: string, stepId: string): void {
  const state = loadInstance(id);
  const def = loadWorkflow(state.workflow_name, state.variant);

  // Validate step exists
  const stepIndex = def.steps.findIndex((s) => s.id === stepId);
  if (stepIndex === -1) {
    console.error(`Step '${stepId}' not found in workflow.`);
    process.exit(1);
  }

  if (!state.steps[stepId]) {
    console.error(`Step '${stepId}' not found in instance state.`);
    process.exit(1);
  }

  // Collect downstream steps for cascade reset
  const downstream = collectDownstream(def, stepId);
  const allToReset = [stepId, ...downstream];

  const resetSteps: string[] = [];

  for (const sid of allToReset) {
    const ss = state.steps[sid];
    if (!ss) continue;

    // Clear output from context
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

  // Update workflow status
  if (state.status === "completed" || state.status === "error") {
    state.status = "in_progress";
  }

  saveInstance(state);

  // Log and fire hooks
  for (const sid of resetSteps) {
    appendLog(state.workflow_name, state.id, "step_reset", sid);
    fireHook(makeHookPayload("step:reset", state.id, state.workflow_name, sid));
  }

  // Output
  console.log(`Reset: ${stepId} → pending (output cleared)`);
  if (downstream.length > 0) {
    console.log(`Cascade: ${downstream.join(", ")} → pending (output cleared)`);
  }
}
