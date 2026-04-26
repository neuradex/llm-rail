import { saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { formatStepStart, formatCompletion, formatAutoCompleted } from "../engine/output.js";
import { appendLog } from "../audit/logger.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";
import { advanceThrough } from "../engine/runner.js";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { saveV1Instance, type V1InstanceState } from "../engine/state-v1.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { advance } from "../engine/runner-v1.js";
import { isAgenticStep, type WorkflowV1Def } from "../types-v1.js";
import {
  formatV1AgenticStart,
  formatV1AutoCompleted,
  formatV1Completion,
} from "../engine/output-v1.js";
import { buildStepContextV1 } from "../engine/context-v1.js";
import { makeFilesystemV1Registry } from "../engine/registry-v1.js";

export function runStart(id: string): void {
  const loaded = loadInstanceAny(id);

  if (loaded.kind === "v1") {
    runStartV1(id, loaded.state);
    return;
  }

  // ── Legacy path ──
  const state = loaded.state;

  if (state.status === "completed") {
    console.error("Workflow already completed.");
    process.exit(1);
  }
  if (state.status === "error") {
    console.error("Workflow in error state.");
    process.exit(1);
  }

  const def = loadWorkflow(state.workflow_name, state.variant);

  state.status = "in_progress";

  try {
    const { reachedStep, autoCompleted } = advanceThrough(def, state);

    if (autoCompleted.length > 0) {
      console.log(formatAutoCompleted(autoCompleted));
    }

    if (reachedStep === -1) {
      state.status = "completed";
      saveInstance(state);
      appendLog(state.workflow_name, state.id, "workflow_completed");
      fireHook(makeHookPayload("workflow:completed", state.id, state.workflow_name));
      console.log(formatCompletion(state));
      return;
    }

    const step = def.steps[reachedStep];

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
    fireHook(makeHookPayload("step:started", state.id, state.workflow_name, step.id, undefined, step.meta));

    console.log(formatStepStart(def, state, reachedStep));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

// ── v1 ──

function runStartV1(idOrAlias: string, state: V1InstanceState): void {
  if (state.status === "completed") {
    console.error("Workflow already completed.");
    process.exit(1);
  }
  if (state.status === "error") {
    console.error("Workflow in error state.");
    process.exit(1);
  }

  const def = loadWorkflowV1(state.workflow_name);
  const registry = makeFilesystemV1Registry();

  state.status = state.status === "created" ? "in_progress" : state.status;

  const result = advance(def, state, registry);

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

  // awaiting_agent
  saveV1Instance(state);
  const pending = result.pendingStep!;
  appendLog(state.workflow_name, state.id, "step_started", pending.id);
  if (isAgenticStep(pending)) {
    const ctx = buildPendingContext(def, state, pending.id);
    console.log(formatV1AgenticStart(def, state, pending, ctx));
  } else {
    // Defensive: runner only pauses on agentic.
    console.log(`Awaiting input on step '${pending.id}'.`);
  }
}

function buildPendingContext(
  def: WorkflowV1Def,
  state: V1InstanceState,
  stepId: string,
): Record<string, unknown> {
  // Find the pending step (could be in this state or in an active call's child).
  if (state.active_call) {
    const childDef = makeFilesystemV1Registry().load(state.active_call.child_workflow_name);
    if (childDef) {
      return buildPendingContext(childDef, state.active_call.child, stepId);
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
