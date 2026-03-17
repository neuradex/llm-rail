import { loadInstance, saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { formatStepStart } from "../engine/output.js";
import { appendLog } from "../audit/logger.js";
import type { WorkflowDef } from "../types.js";

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
  state.steps[step.id].status = "in_progress";
  state.current_step = stepIndex;
  state.status = "in_progress";
  saveInstance(state);

  appendLog(state.id, "step_started", step.id);

  console.log(formatStepStart(def, state, stepIndex));
}

function findNextStep(def: WorkflowDef, state: ReturnType<typeof loadInstance>): number {
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const ss = state.steps[step.id];
    if (ss.status !== "pending") continue;

    // Check depends_on
    if (step.depends_on) {
      const depState = state.steps[step.depends_on];
      if (!depState || depState.status !== "completed") continue;
    }

    return i;
  }
  return -1;
}
