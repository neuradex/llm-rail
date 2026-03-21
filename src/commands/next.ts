import { loadInstance, saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { validateStepOutput, runAssertions } from "../engine/validator.js";
import { formatStepStart, formatRejection, formatCompletion, formatAutoCompleted } from "../engine/output.js";
import { appendLog } from "../audit/logger.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";
import { collectStepOutputs } from "../engine/context.js";
import { executeActions } from "../engine/actions.js";
import { advanceThrough } from "../engine/runner.js";
import { nowISO } from "../util.js";
import type { WorkflowDef, InstanceState } from "../types.js";

export function runNext(id: string, resultJson: string): void {
  const state = loadInstance(id);

  if (state.status !== "in_progress") {
    console.error(`Workflow is not in progress (status: ${state.status}). Run 'lrail ${id} start' first.`);
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

  // Validate step output (validation rules)
  const result = validateStepOutput(currentStep, output);

  if (!result.valid) {
    appendLog(state.workflow_name, state.id, "step_rejected", currentStep.id, { errors: result.errors });
    fireHook(
      makeHookPayload("step:rejected", state.id, state.workflow_name, currentStep.id, {
        errors: result.errors,
      }),
    );
    console.log(formatRejection(state, currentStep, result.errors));
    process.exit(1);
  }

  // Gate hook: step:before_complete
  const hookResult = fireHook(
    makeHookPayload(
      "step:before_complete",
      state.id,
      state.workflow_name,
      currentStep.id,
      { output },
      currentStep.meta,
    ),
  );
  if (!hookResult.allow) {
    console.error(
      `Step '${currentStep.id}' completion blocked by hook: ${hookResult.message || "no reason given"}`,
    );
    process.exit(1);
  }

  // Execute post-validation actions if defined on agentic step
  if (currentStep.actions && currentStep.actions.length > 0) {
    try {
      const extracted = executeActions(currentStep.actions, { ...state.context, ...output });
      Object.assign(output, extracted);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Action failed in step '${currentStep.id}': ${message}`);
      process.exit(1);
    }
  }

  // Complete current step
  state.steps[currentStep.id].status = "completed";
  state.steps[currentStep.id].output = output;
  state.steps[currentStep.id].completed_at = nowISO();

  // Merge output into context
  Object.assign(state.context, output);

  appendLog(state.workflow_name, state.id, "step_completed", currentStep.id, { output });

  // Event hook: step:completed
  fireHook(
    makeHookPayload("step:completed", state.id, state.workflow_name, currentStep.id, { output }, currentStep.meta),
  );

  // Run cross-step assertions if defined
  if (currentStep.assertions) {
    const mergedData: Record<string, unknown> = { ...state.context };
    const assertResult = runAssertions(currentStep.assertions, mergedData);

    // Log script assertion results to audit log
    if (assertResult.script_logs) {
      appendLog(state.workflow_name, state.id, "script_assertion", currentStep.id, {
        logs: assertResult.script_logs,
      });
    }

    if (!assertResult.valid) {
      appendLog(state.workflow_name, state.id, "assertion_failed", currentStep.id, { errors: assertResult.errors });
      // Revert step completion
      state.steps[currentStep.id].status = "in_progress";
      state.steps[currentStep.id].output = undefined;
      state.steps[currentStep.id].completed_at = undefined;
      // Remove output from context
      for (const key of Object.keys(output)) {
        delete state.context[key];
      }
      saveInstance(state);
      console.log(formatRejection(state, currentStep, assertResult.errors));
      process.exit(1);
    }
  }

  // Advance through programmatic steps
  try {
    const { reachedStep, autoCompleted } = advanceThrough(def, state);

    if (autoCompleted.length > 0) {
      console.log(formatAutoCompleted(autoCompleted));
    }

    if (reachedStep === -1) {
      // Workflow complete
      state.status = "completed";
      saveInstance(state);
      appendLog(state.workflow_name, state.id, "workflow_completed");
      fireHook(makeHookPayload("workflow:completed", state.id, state.workflow_name));
      console.log(formatCompletion(state));
      return;
    }

    // Start next agentic step
    const nextStep = def.steps[reachedStep];
    state.steps[nextStep.id].status = "in_progress";
    state.current_step = reachedStep;
    saveInstance(state);

    appendLog(state.workflow_name, state.id, "step_started", nextStep.id);
    fireHook(
      makeHookPayload("step:started", state.id, state.workflow_name, nextStep.id, undefined, nextStep.meta),
    );

    console.log(formatStepStart(def, state, reachedStep));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}
