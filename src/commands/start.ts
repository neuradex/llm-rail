import { loadInstance, saveInstance } from "../engine/state.js";
import { loadWorkflow, normalizeDeps } from "../engine/workflow.js";
import { formatStepStart } from "../engine/output.js";
import { appendLog } from "../audit/logger.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";
import { isReady } from "../engine/dependency.js";
import type { WorkflowDef, InstanceState } from "../types.js";

export function runStart(id: string): void {
  const state = loadInstance(id);

  if (state.status === "completed") {
    console.error("Workflow already completed.");
    process.exit(1);
  }
  if (state.status === "error") {
    console.error("Workflow in error state.");
    process.exit(1);
  }

  const def = loadWorkflow(state.workflow_name);
  const stepIndex = findNextStep(def, state);

  if (stepIndex === -1) {
    console.error("No available step to start.");
    process.exit(1);
  }

  const step = def.steps[stepIndex];

  // Gate hook: step:before_start
  const hookResult = fireHook(
    makeHookPayload("step:before_start", state.id, state.workflow_name, step.id, undefined, step.meta),
  );
  if (!hookResult.allow) {
    console.error(`Step '${step.id}' blocked by hook: ${hookResult.message || "no reason given"}`);
    process.exit(1);
  }

  state.steps[step.id].status = "in_progress";
  state.current_step = stepIndex;
  state.status = "in_progress";
  saveInstance(state);

  appendLog(state.id, "step_started", step.id);

  // Event hook: step:started
  fireHook(makeHookPayload("step:started", state.id, state.workflow_name, step.id, undefined, step.meta));

  console.log(formatStepStart(def, state, stepIndex));
}

function findNextStep(def: WorkflowDef, state: InstanceState): number {
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const ss = state.steps[step.id];
    if (ss.status !== "pending") continue;

    if (!isReady(def, step.id, state.steps)) continue;

    return i;
  }
  return -1;
}
