import { loadInstance, saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { validateStepOutput } from "../engine/validator.js";
import { formatStepStart, formatRejection, formatCompletion } from "../engine/output.js";
import { appendLog } from "../audit/logger.js";
import { nowISO } from "../util.js";
import type { WorkflowDef, InstanceState } from "../types.js";

export function runNext(id: string, resultJson: string): void {
  const state = loadInstance(id);

  if (state.status !== "in_progress") {
    console.error(`Workflow is not in progress (status: ${state.status}).`);
    process.exit(1);
  }

  const def = loadWorkflow(state.workflow_name);
  const currentStep = def.steps[state.current_step];

  if (!currentStep) {
    console.error("No current step found.");
    process.exit(1);
  }

  // Parse result
  let output: Record<string, unknown>;
  try {
    output = JSON.parse(resultJson);
  } catch {
    console.error("Invalid JSON in --result");
    process.exit(1);
  }

  // Validate
  const result = validateStepOutput(currentStep, output);

  if (!result.valid) {
    appendLog(state.id, "step_rejected", currentStep.id, { errors: result.errors });
    console.log(formatRejection(state, currentStep, result.errors));
    process.exit(1);
  }

  // Complete current step
  state.steps[currentStep.id].status = "completed";
  state.steps[currentStep.id].output = output;
  state.steps[currentStep.id].completed_at = nowISO();

  // Merge output into context
  Object.assign(state.context, output);

  appendLog(state.id, "step_completed", currentStep.id, { output });

  // Find next step
  const nextIndex = findNextPending(def, state);

  if (nextIndex === -1) {
    // Workflow complete
    state.status = "completed";
    saveInstance(state);
    appendLog(state.id, "workflow_completed");
    console.log(formatCompletion(state));
    return;
  }

  // Start next step
  const nextStep = def.steps[nextIndex];
  state.steps[nextStep.id].status = "in_progress";
  state.current_step = nextIndex;
  saveInstance(state);

  appendLog(state.id, "step_started", nextStep.id);

  console.log(formatStepStart(def, state, nextIndex));
}

function findNextPending(def: WorkflowDef, state: InstanceState): number {
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const ss = state.steps[step.id];
    if (ss.status !== "pending") continue;

    if (step.depends_on) {
      const depState = state.steps[step.depends_on];
      if (!depState || depState.status !== "completed") continue;
    }

    return i;
  }
  return -1;
}
