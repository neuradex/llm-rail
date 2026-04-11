import type { WorkflowDef, InstanceState, LrailGoto } from "../types.js";
import { executeActions } from "./actions.js";
import { appendLog } from "../audit/logger.js";
import { saveInstance } from "./state.js";
import { nowISO } from "../util.js";
import { buildStepContext, collectStepOutputs } from "./context.js";

/**
 * Advance through consecutive programmatic steps starting from the current position.
 * Executes actions for each programmatic step and auto-completes them.
 * Stops when an agentic step is found or the workflow is complete.
 *
 * Steps execute in array order. Programmatic steps can return lrail.goto()
 * to jump to any step — the target and all subsequent steps are reset to pending.
 *
 * Returns the index of the next agentic step (-1 if workflow complete)
 * and a list of auto-completed step IDs.
 */
export function advanceThrough(
  def: WorkflowDef,
  state: InstanceState,
): { reachedStep: number; autoCompleted: string[] } {
  const autoCompleted: string[] = [];

  while (true) {
    // Find next pending step in array order
    const nextIndex = findNextPending(def, state);
    if (nextIndex === -1) {
      return { reachedStep: -1, autoCompleted };
    }

    const step = def.steps[nextIndex];
    const stepType = step.type || "agentic";

    if (stepType === "agentic") {
      return { reachedStep: nextIndex, autoCompleted };
    }

    // Programmatic step: execute actions and auto-complete
    try {
      const stepOutputs = collectStepOutputs(state.steps, state.context);
      const stepContext = buildStepContext(step, state.params || {}, stepOutputs);
      const fullContext = { ...(state.params || {}), ...state.context, ...stepContext };
      const result = executeActions(step.actions || [], fullContext);

      state.steps[step.id].status = "completed";
      state.steps[step.id].output = result.extracted;
      state.steps[step.id].completed_at = nowISO();
      Object.assign(state.context, result.extracted);
      state.current_step = nextIndex;

      appendLog(state.workflow_name, state.id, "step_auto_completed", step.id, { output: result.extracted });
      autoCompleted.push(step.id);

      // Handle goto: reset target + all steps after it, then continue loop
      if (result.goto) {
        applyGoto(def, state, result.goto, nextIndex);
        appendLog(state.workflow_name, state.id, "goto", step.id, { target: result.goto.target });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      state.status = "error";
      appendLog(state.workflow_name, state.id, "action_failed", step.id, { error: message });
      saveInstance(state);
      throw new Error(`Action failed in step '${step.id}': ${message}`);
    }
  }
}

/**
 * Apply a goto: reset the target step and all steps after it to pending.
 * Context is NOT cleared — step outputs overwrite naturally on re-execution.
 */
function applyGoto(def: WorkflowDef, state: InstanceState, goto: LrailGoto, fromIndex: number): void {
  const targetIndex = def.steps.findIndex((s) => s.id === goto.target);
  if (targetIndex === -1) {
    throw new Error(`goto target '${goto.target}' not found in workflow`);
  }

  // Forward goto: skip intermediate steps so findNextPending doesn't pick them up
  if (targetIndex > fromIndex) {
    for (let i = fromIndex + 1; i < targetIndex; i++) {
      const step = def.steps[i];
      const ss = state.steps[step.id];
      if (ss && ss.status === "pending") {
        ss.status = "completed";
        ss.completed_at = nowISO();
      }
    }
  }

  // Reset target step and all steps after it
  for (let i = targetIndex; i < def.steps.length; i++) {
    const step = def.steps[i];
    const ss = state.steps[step.id];
    if (ss) {
      ss.status = "pending";
      ss.output = undefined;
      ss.completed_at = undefined;
    }
  }
}

function findNextPending(def: WorkflowDef, state: InstanceState): number {
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const ss = state.steps[step.id];
    if (ss.status !== "pending") continue;
    return i;
  }
  return -1;
}
