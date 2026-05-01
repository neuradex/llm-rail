import { appendLog } from "../audit/logger.js";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { saveV1Instance, type V1InstanceState } from "../engine/state-v1.js";
import {
  submitAgenticResult,
  V1AssertionFailure,
  V1OutputValidationError,
} from "../engine/runner-v1.js";
import { makeFilesystemV1Registry } from "../engine/registry-v1.js";
import {
  formatV1AgenticStart,
  formatV1AutoCompleted,
  formatV1Completion,
  formatV1Rejection,
} from "../engine/output-v1.js";
import { buildStepContextV1 } from "../engine/context-v1.js";
import { isAgenticStep, type WorkflowV1Def } from "../types-v1.js";

export function runNext(id: string, resultJson: string): void {
  const { state } = loadInstanceAny(id);
  runNextV1(id, state, resultJson);
}

function runNextV1(idOrAlias: string, state: V1InstanceState, resultJson: string): void {
  if (state.status !== "in_progress") {
    console.error(
      `Workflow is not in progress (status: ${state.status}). Run 'lrail ${idOrAlias} start' first.`,
    );
    process.exit(1);
  }

  let output: Record<string, unknown>;
  try {
    output = JSON.parse(resultJson);
  } catch {
    console.error("Invalid JSON in --result");
    process.exit(1);
  }

  const def = loadWorkflowV1(state.workflow_name);
  const registry = makeFilesystemV1Registry();

  let result;
  try {
    result = submitAgenticResult(def, state, output, registry);
  } catch (err) {
    if (err instanceof V1OutputValidationError) {
      saveV1Instance(state);
      const pendingStep = currentAgenticStep(def, state);
      appendLog(state.workflow_name, state.id, "step_rejected", err.stepId, {
        errors: err.validationErrors,
      });
      if (pendingStep) {
        const ctx = buildPendingContextV1(def, state, pendingStep.id);
        console.log(
          formatV1Rejection(state, pendingStep, err.schemaName, err.validationErrors, ctx),
        );
      } else {
        console.log(
          `Submission rejected:\n${err.validationErrors.map((e) => `  - ${e}`).join("\n")}`,
        );
      }
      process.exit(1);
    }
    if (err instanceof V1AssertionFailure) {
      saveV1Instance(state);
      const pendingStep = currentAgenticStep(def, state);
      appendLog(state.workflow_name, state.id, "step_rejected", err.stepId, {
        errors: err.errors,
        kind: err.kind,
      });
      if (pendingStep) {
        const ctx = buildPendingContextV1(def, state, pendingStep.id);
        console.log(
          formatV1Rejection(state, pendingStep, err.kind, err.errors, ctx),
        );
      } else {
        console.log(
          `Submission rejected (${err.kind}):\n${err.errors.map((e) => `  - ${e}`).join("\n")}`,
        );
      }
      process.exit(1);
    }
    saveV1Instance(state);
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  if (result.autoCompleted.length > 0) {
    console.log(formatV1AutoCompleted(result.autoCompleted));
    for (const stepId of result.autoCompleted) {
      appendLog(state.workflow_name, state.id, "step_auto_completed", stepId);
    }
  }

  if (result.kind === "completed") {
    saveV1Instance(state);
    appendLog(state.workflow_name, state.id, "workflow_completed");
    console.log(formatV1Completion(state));
    return;
  }

  if (result.kind === "error") {
    saveV1Instance(state);
    appendLog(state.workflow_name, state.id, "workflow_error", undefined, {
      message: result.error?.message,
    });
    console.error(`Workflow error: ${result.error?.message}`);
    process.exit(1);
  }

  saveV1Instance(state);
  const pending = result.pendingStep!;
  appendLog(state.workflow_name, state.id, "step_started", pending.id);
  if (isAgenticStep(pending)) {
    const ctx = buildPendingContextV1(def, state, pending.id);
    console.log(formatV1AgenticStart(def, state, pending, ctx));
  } else {
    console.log(`Awaiting input on step '${pending.id}'.`);
  }
}

function currentAgenticStep(def: WorkflowV1Def, state: V1InstanceState) {
  if (state.active_call) {
    const childDef = makeFilesystemV1Registry().load(state.active_call.child_workflow_name);
    if (childDef) {
      return currentAgenticStep(childDef, state.active_call.child);
    }
  }
  const stepId = state.current_step_id;
  if (!stepId) return undefined;
  const step = def.steps.find((s) => s.id === stepId);
  return step && isAgenticStep(step) ? step : undefined;
}

function buildPendingContextV1(
  def: WorkflowV1Def,
  state: V1InstanceState,
  stepId: string,
): Record<string, unknown> {
  if (state.active_call) {
    const childDef = makeFilesystemV1Registry().load(state.active_call.child_workflow_name);
    if (childDef) {
      return buildPendingContextV1(childDef, state.active_call.child, stepId);
    }
  }
  const step = def.steps.find((s) => s.id === stepId);
  if (!step || !isAgenticStep(step)) return {};
  try {
    return buildStepContextV1(stepId, step.context_in, state);
  } catch {
    return {};
  }
}
