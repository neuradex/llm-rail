import { loadInstance, saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { formatStepStart, formatCompletion, formatAutoCompleted } from "../engine/output.js";
import { appendLog } from "../audit/logger.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";
import { advanceThrough } from "../engine/runner.js";
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

  const def = loadWorkflow(state.workflow_name, state.variant);

  // First, advance through any leading programmatic steps
  state.status = "in_progress";

  try {
    const { reachedStep, autoCompleted } = advanceThrough(def, state);

    if (autoCompleted.length > 0) {
      console.log(formatAutoCompleted(autoCompleted));
    }

    if (reachedStep === -1) {
      // All steps were programmatic and completed
      state.status = "completed";
      saveInstance(state);
      appendLog(state.workflow_name, state.id, "workflow_completed");
      fireHook(makeHookPayload("workflow:completed", state.id, state.workflow_name));
      console.log(formatCompletion(state));
      return;
    }

    const step = def.steps[reachedStep];

    // Gate hook: step:before_start
    const hookResult = fireHook(
      makeHookPayload("step:before_start", state.id, state.workflow_name, step.id, undefined, step.meta),
    );
    if (!hookResult.allow) {
      saveInstance(state);
      console.error(`Step '${step.id}' blocked by hook: ${hookResult.message || "no reason given"}`);
      process.exit(1);
    }

    state.steps[step.id].status = "in_progress";
    state.current_step = reachedStep;
    saveInstance(state);

    appendLog(state.workflow_name, state.id, "step_started", step.id);

    // Event hook: step:started
    fireHook(makeHookPayload("step:started", state.id, state.workflow_name, step.id, undefined, step.meta));

    console.log(formatStepStart(def, state, reachedStep));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}
