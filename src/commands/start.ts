import { appendLog } from "../audit/logger.js";
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
  const { state } = loadInstanceAny(id);
  runStartV1(state);
}

function runStartV1(state: V1InstanceState): void {
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

  saveV1Instance(state);
  const pending = result.pendingStep!;
  appendLog(state.workflow_name, state.id, "step_started", pending.id);
  if (isAgenticStep(pending)) {
    const ctx = buildPendingContext(def, state, pending.id);
    console.log(formatV1AgenticStart(def, state, pending, ctx));
  } else {
    console.log(`Awaiting input on step '${pending.id}'.`);
  }
}

function buildPendingContext(
  def: WorkflowV1Def,
  state: V1InstanceState,
  stepId: string,
): Record<string, unknown> {
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
