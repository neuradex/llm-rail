import {
  isAgenticStep,
  isCallStep,
  isProgrammaticStep,
  isRouterStep,
  type V1StepDef,
  type WorkflowV1Def,
} from "../types-v1.js";
import { nowISO } from "../util.js";
import { executeV1Actions } from "./actions-v1.js";
import { buildStepContextV1 } from "./context-v1.js";
import type { V1InstanceState, V1StepState } from "./state-v1.js";
import { buildSchemaRegistry, type SchemaRegistry } from "./schemas.js";
import { applyRouterGoto, evaluateRouter } from "./router-v1.js";

// ── Errors ──

export class V1RunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "V1RunnerError";
  }
}

export class V1OutputValidationError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly schemaName: string,
    public readonly validationErrors: string[],
  ) {
    super(
      `Step '${stepId}' output failed validation against schema '${schemaName}':\n` +
        validationErrors.map((e) => `  - ${e}`).join("\n"),
    );
    this.name = "V1OutputValidationError";
  }
}

// ── Advance result ──

export interface AdvanceResult {
  /**
   * - "awaiting_agent": paused at an agentic step; caller must collect the
   *    agent's output and feed it to `submitAgenticResult`.
   * - "completed": the workflow has no more steps; state.status === "completed".
   * - "error": an unrecoverable error occurred; state.status === "error".
   */
  kind: "awaiting_agent" | "completed" | "error";
  /** Present when kind === "awaiting_agent". */
  pendingStep?: V1StepDef;
  /** List of programmatic step ids executed during this advance. */
  autoCompleted: string[];
  /** Present when kind === "error". */
  error?: Error;
}

// ── Public API ──

/**
 * Drive the instance forward as far as possible without agent interaction.
 *
 * Starting from `state.current_step_id`, execute programmatic steps in
 * sequence, stopping at the first agentic step. Router and call steps are
 * recognized but not yet implemented (raise V1RunnerError) — they arrive
 * in PR #3 and PR #4 respectively.
 */
export function advance(
  def: WorkflowV1Def,
  state: V1InstanceState,
): AdvanceResult {
  const { registry } = buildSchemaRegistry(def.schemas);
  const autoCompleted: string[] = [];

  while (true) {
    const stepId = state.current_step_id;
    if (!stepId) {
      state.status = "completed";
      state.updated_at = nowISO();
      return { kind: "completed", autoCompleted };
    }

    const step = findStep(def, stepId);
    if (!step) {
      const err = new V1RunnerError(
        `current_step_id '${stepId}' does not exist in workflow`,
      );
      state.status = "error";
      state.updated_at = nowISO();
      return { kind: "error", autoCompleted, error: err };
    }

    const stepState = state.steps[stepId];
    if (!stepState) {
      const err = new V1RunnerError(
        `instance state missing entry for step '${stepId}'`,
      );
      state.status = "error";
      state.updated_at = nowISO();
      return { kind: "error", autoCompleted, error: err };
    }

    // Agentic: pause and hand control to the caller.
    if (isAgenticStep(step)) {
      if (stepState.status === "pending") {
        stepState.status = "in_progress";
      }
      state.status = state.status === "created" ? "in_progress" : state.status;
      state.updated_at = nowISO();
      return { kind: "awaiting_agent", pendingStep: step, autoCompleted };
    }

    // Router: evaluate cases, record decision, apply goto (forward or backward).
    if (isRouterStep(step)) {
      try {
        stepState.status = "in_progress";
        const routerContext = buildStepContextV1(step.id, step.context_in, state);
        const decision = evaluateRouter(step, routerContext, state);
        const stepOrder = def.steps.map((s) => s.id);
        const gotoResult = applyRouterGoto(step, decision.goto, stepOrder, state);

        // Record the decision as the router's output. Backward gotos bump
        // the iteration counter; forward gotos leave it untouched (the
        // router completed once and advanced).
        const output: Record<string, unknown> = {
          selected_goto: decision.goto,
          selected_case: decision.case_index,
          used_default: decision.used_default,
        };
        if (gotoResult.backward) {
          output.iteration = gotoResult.newIterations;
        }
        // On backward goto, applyRouterGoto reset the router's own state.
        // We must re-mark it completed *after* the reset so its output is
        // observable to downstream steps that reference it.
        const freshRouterState = state.steps[step.id];
        if (freshRouterState) {
          freshRouterState.status = "completed";
          freshRouterState.output = output;
          freshRouterState.completed_at = nowISO();
          freshRouterState.iterations = gotoResult.newIterations ?? (freshRouterState.iterations ?? 0) + 1;
        }

        autoCompleted.push(step.id);
        state.status = state.status === "created" ? "in_progress" : state.status;
        state.updated_at = nowISO();
        continue;
      } catch (err) {
        stepState.status = "pending";
        state.status = "error";
        state.updated_at = nowISO();
        return { kind: "error", autoCompleted, error: err as Error };
      }
    }

    if (isCallStep(step)) {
      const err = new V1RunnerError(
        `call step '${stepId}' is not yet implemented (PR #4)`,
      );
      state.status = "error";
      state.updated_at = nowISO();
      return { kind: "error", autoCompleted, error: err };
    }

    // Programmatic: execute actions, validate output, advance to next step.
    if (isProgrammaticStep(step)) {
      try {
        stepState.status = "in_progress";
        const context = buildStepContextV1(step.id, step.context_in, state);
        const timeout = step.timeout_ms ?? 30_000;
        const result = executeV1Actions(step.actions, context, timeout);

        if (step.required_output) {
          assertValidOutput(step.id, step.required_output, result.extracted, registry);
        }

        completeStep(stepState, result.extracted);
        autoCompleted.push(step.id);
        state.current_step_id = nextStepId(def, step.id);
        state.status = state.status === "created" ? "in_progress" : state.status;
        state.updated_at = nowISO();
        continue;
      } catch (err) {
        stepState.status = "pending";
        state.status = "error";
        state.updated_at = nowISO();
        return { kind: "error", autoCompleted, error: err as Error };
      }
    }

    // Unknown type — defensive; validation should have caught this at load time.
    const err = new V1RunnerError(
      `unknown step type '${(step as { type: string }).type}' for step '${stepId}'`,
    );
    state.status = "error";
    state.updated_at = nowISO();
    return { kind: "error", autoCompleted, error: err };
  }
}

/**
 * Submit an agent's proposed output for the current agentic step.
 * Validates against the step's `required_output` schema, records the
 * output on success, and advances to the next step.
 *
 * Throws if the current step is not agentic, or if validation fails.
 * Validation failure leaves the step in `in_progress` so the caller can
 * ask the agent to retry.
 */
export function submitAgenticResult(
  def: WorkflowV1Def,
  state: V1InstanceState,
  output: Record<string, unknown>,
): AdvanceResult {
  const stepId = state.current_step_id;
  if (!stepId) {
    throw new V1RunnerError("no current step to submit to");
  }
  const step = findStep(def, stepId);
  if (!step || !isAgenticStep(step)) {
    throw new V1RunnerError(
      `submitAgenticResult called on non-agentic step '${stepId}'`,
    );
  }
  const stepState = state.steps[stepId];
  if (!stepState) {
    throw new V1RunnerError(`instance state missing entry for step '${stepId}'`);
  }

  const { registry } = buildSchemaRegistry(def.schemas);
  assertValidOutput(step.id, step.required_output, output, registry);

  completeStep(stepState, output);
  state.current_step_id = nextStepId(def, step.id);
  state.status = state.status === "created" ? "in_progress" : state.status;
  state.updated_at = nowISO();

  return advance(def, state);
}

// ── Internal helpers ──

function findStep(def: WorkflowV1Def, id: string): V1StepDef | undefined {
  return def.steps.find((s) => s.id === id);
}

function nextStepId(def: WorkflowV1Def, currentId: string): string | null {
  const idx = def.steps.findIndex((s) => s.id === currentId);
  if (idx === -1 || idx >= def.steps.length - 1) return null;
  return def.steps[idx + 1].id;
}

function completeStep(stepState: V1StepState, output: Record<string, unknown>): void {
  stepState.status = "completed";
  stepState.output = output;
  stepState.completed_at = nowISO();
  stepState.iterations = (stepState.iterations ?? 0) + 1;
}

function assertValidOutput(
  stepId: string,
  schemaName: string,
  output: unknown,
  registry: SchemaRegistry,
): void {
  const result = registry.validate(schemaName, output);
  if (!result.valid) {
    throw new V1OutputValidationError(stepId, schemaName, result.errors);
  }
}
