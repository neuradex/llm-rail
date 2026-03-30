import type { WorkflowDef, InstanceState } from "../types.js";
import { isReady } from "./dependency.js";
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
 * Returns the index of the next agentic step (-1 if workflow complete)
 * and a list of auto-completed step IDs.
 */
export function advanceThrough(
  def: WorkflowDef,
  state: InstanceState,
): { reachedStep: number; autoCompleted: string[] } {
  const autoCompleted: string[] = [];

  while (true) {
    // Find next pending step with ready deps
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
      // Resolve context_in for programmatic steps
      const stepOutputs = collectStepOutputs(state.steps);
      const stepContext = buildStepContext(step, state.params || {}, stepOutputs);
      const fullContext = { ...(state.params || {}), ...state.context, ...stepContext };
      const extracted = executeActions(step.actions || [], fullContext);

      state.steps[step.id].status = "completed";
      state.steps[step.id].output = extracted;
      state.steps[step.id].completed_at = nowISO();
      Object.assign(state.context, extracted);
      state.current_step = nextIndex;

      appendLog(state.workflow_name, state.id, "step_auto_completed", step.id, { output: extracted });
      autoCompleted.push(step.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      state.status = "error";
      appendLog(state.workflow_name, state.id, "action_failed", step.id, { error: message });
      saveInstance(state);
      throw new Error(`Action failed in step '${step.id}': ${message}`);
    }
  }
}

function findNextPending(def: WorkflowDef, state: InstanceState): number {
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const ss = state.steps[step.id];
    if (ss.status !== "pending") continue;
    if (!isReady(def, step.id, state.steps)) continue;
    return i;
  }
  return -1;
}
