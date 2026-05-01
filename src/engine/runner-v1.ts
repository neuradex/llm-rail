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
import type { V1InstanceState } from "./state-v1.js";
import { buildSchemaRegistry, type SchemaRegistry } from "./schemas.js";
import { applyRouterGoto, evaluateRouter } from "./router-v1.js";
import {
  beginCall,
  collectWorkflowOutput,
  V1CallError,
  type V1WorkflowRegistry,
} from "./call-v1.js";
import { applyRule } from "./ops-v1.js";
import type { AssertionRule } from "../types.js";

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

export class V1AssertionFailure extends Error {
  constructor(
    public readonly stepId: string,
    public readonly kind: "validation" | "assertions",
    public readonly errors: string[],
  ) {
    super(
      `Step '${stepId}' ${kind} failed:\n` +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
    this.name = "V1AssertionFailure";
  }
}

/**
 * Run a list of AssertionRule entries against an output object. Each
 * rule's `field` is looked up on `output`; missing fields are skipped
 * (use schema `required` for presence). Aggregates every failure
 * into a single error array — first failure does not short-circuit.
 */
function runRules(
  rules: AssertionRule[] | undefined,
  output: Record<string, unknown>,
): string[] {
  if (!rules || rules.length === 0) return [];
  const errs: string[] = [];
  for (const rule of rules) {
    const value = output[rule.field];
    if (value === undefined || value === null) continue;
    const err = applyRule(rule, value);
    if (err) errs.push(err);
  }
  return errs;
}

// ── Advance result ──

export interface AdvanceResult {
  /**
   * - "awaiting_agent": paused at an agentic step (possibly inside a
   *    nested `call`); the caller must collect the agent's output and
   *    feed it to `submitAgenticResult` on the *top-level* state. The
   *    runner routes it down to the deepest active call automatically.
   * - "completed": the instance has no more steps.
   * - "error": an unrecoverable error occurred.
   */
  kind: "awaiting_agent" | "completed" | "error";
  /** Present when kind === "awaiting_agent". */
  pendingStep?: V1StepDef;
  /** List of step ids auto-completed during this advance, at this level only. */
  autoCompleted: string[];
  /** Present when kind === "error". */
  error?: Error;
}

// ── Public API ──

/**
 * Drive an instance forward until either an agentic step pauses it or
 * the workflow ends. If a `call` step spawns a child, execution
 * transparently recurses into the child; a child's agentic pause
 * propagates upward as awaiting_agent on this result.
 *
 * The registry is required only for workflows that contain `call`
 * steps. Omit it for simple agentic/programmatic/router workflows.
 */
export function advance(
  def: WorkflowV1Def,
  state: V1InstanceState,
  registry?: V1WorkflowRegistry,
): AdvanceResult {
  const { registry: schemaRegistry } = buildSchemaRegistry(def.schemas);
  const autoCompleted: string[] = [];

  while (true) {
    // A child sub-instance is in-flight: delegate.
    if (state.active_call) {
      const r = advanceActiveCall(def, state, registry, autoCompleted);
      if (r) return r;
      continue; // child completed and parent resumed; keep going
    }

    const stepId = state.current_step_id;
    if (!stepId) {
      state.status = "completed";
      state.updated_at = nowISO();
      return { kind: "completed", autoCompleted };
    }

    const step = findStep(def, stepId);
    if (!step) {
      return errorResult(state, autoCompleted, new V1RunnerError(
        `current_step_id '${stepId}' does not exist in workflow`,
      ));
    }

    const stepState = state.steps[stepId];
    if (!stepState) {
      return errorResult(state, autoCompleted, new V1RunnerError(
        `instance state missing entry for step '${stepId}'`,
      ));
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

    // Router: evaluate cases, record decision, apply goto.
    if (isRouterStep(step)) {
      try {
        stepState.status = "in_progress";
        const routerContext = buildStepContextV1(step.id, step.context_in, state);
        const decision = evaluateRouter(step, routerContext, state);
        const stepOrder = def.steps.map((s) => s.id);
        const gotoResult = applyRouterGoto(step, decision.goto, stepOrder, state);

        const output: Record<string, unknown> = {
          selected_goto: decision.goto,
          selected_case: decision.case_index,
          used_default: decision.used_default,
        };
        if (gotoResult.backward) {
          output.iteration = gotoResult.newIterations;
        }

        // On backward goto, applyRouterGoto reset the router's own state.
        // Re-mark it completed *after* the reset so downstream references
        // to {router.selected_goto} work.
        const freshRouterState = state.steps[step.id];
        if (freshRouterState) {
          freshRouterState.status = "completed";
          freshRouterState.output = output;
          freshRouterState.completed_at = nowISO();
          freshRouterState.iterations =
            gotoResult.newIterations ?? (freshRouterState.iterations ?? 0) + 1;
        }
        state.last_completed_step_id = step.id;

        autoCompleted.push(step.id);
        state.status = state.status === "created" ? "in_progress" : state.status;
        state.updated_at = nowISO();
        continue;
      } catch (err) {
        stepState.status = "pending";
        return errorResult(state, autoCompleted, err as Error);
      }
    }

    // Call: spawn the child, then loop so the active_call branch picks it up.
    if (isCallStep(step)) {
      if (!registry) {
        return errorResult(state, autoCompleted, new V1RunnerError(
          `call step '${stepId}' requires a workflow registry`,
        ));
      }
      try {
        stepState.status = "in_progress";
        beginCall(step, state, registry);
        continue;
      } catch (err) {
        stepState.status = "pending";
        return errorResult(state, autoCompleted, err as Error);
      }
    }

    // Programmatic: execute actions, validate, advance.
    if (isProgrammaticStep(step)) {
      try {
        stepState.status = "in_progress";
        const context = buildStepContextV1(step.id, step.context_in, state);
        const timeout = step.timeout_ms ?? 30_000;
        const result = executeV1Actions(step.actions, context, timeout);

        if (step.required_output) {
          assertValidOutput(step.id, step.required_output, result.extracted, schemaRegistry);
        }

        const valErrs = runRules(step.validation, result.extracted);
        if (valErrs.length > 0) {
          throw new V1AssertionFailure(step.id, "validation", valErrs);
        }

        finishStep(state, step.id, result.extracted);

        const asnErrs = runRules(step.assertions, result.extracted);
        if (asnErrs.length > 0) {
          revertStep(state, step.id);
          throw new V1AssertionFailure(step.id, "assertions", asnErrs);
        }

        autoCompleted.push(step.id);
        state.current_step_id = nextStepId(def, step.id);
        state.status = state.status === "created" ? "in_progress" : state.status;
        state.updated_at = nowISO();
        continue;
      } catch (err) {
        stepState.status = "pending";
        return errorResult(state, autoCompleted, err as Error);
      }
    }

    return errorResult(state, autoCompleted, new V1RunnerError(
      `unknown step type '${(step as { type: string }).type}' for step '${stepId}'`,
    ));
  }
}

/**
 * Submit an agent's proposed output. This targets the deepest active
 * agentic step: if there is an in-flight `call`, the output is routed
 * to that child (possibly recursively). Callers only ever interact
 * with the top-level state.
 */
export function submitAgenticResult(
  def: WorkflowV1Def,
  state: V1InstanceState,
  output: Record<string, unknown>,
  registry?: V1WorkflowRegistry,
): AdvanceResult {
  // Descend into nested call if active.
  if (state.active_call) {
    if (!registry) {
      throw new V1RunnerError(
        "submitAgenticResult encountered an active call but no registry was provided",
      );
    }
    const childDef = registry.load(state.active_call.child_workflow_name);
    if (!childDef) {
      throw new V1RunnerError(
        `active call references unknown workflow '${state.active_call.child_workflow_name}'`,
      );
    }
    // Recurse: this routes all the way down to the deepest agentic step.
    submitAgenticResult(childDef, state.active_call.child, output, registry);
    // After the recursive submit, the child may still be waiting, or may
    // have completed (possibly through further programmatic / nested
    // call steps). In either case we continue the parent by re-entering
    // advance, which will re-inspect active_call and delegate.
    return advance(def, state, registry);
  }

  // Top-level agentic submit.
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

  const { registry: schemaRegistry } = buildSchemaRegistry(def.schemas);
  assertValidOutput(step.id, step.required_output, output, schemaRegistry);

  // Residual `validation:` rules (script, verify_source, matches,
  // each_has, contains, etc.) — schema doesn't cover these. Failure
  // here keeps the step in_progress so the agent can retry.
  const valErrs = runRules(step.validation, output);
  if (valErrs.length > 0) {
    throw new V1AssertionFailure(step.id, "validation", valErrs);
  }

  finishStep(state, step.id, output);

  // Cross-step `assertions:` (post-completion). Failure reverts the
  // step back to in_progress so the agent retries with full context.
  const asnErrs = runRules(step.assertions, output);
  if (asnErrs.length > 0) {
    revertStep(state, step.id);
    throw new V1AssertionFailure(step.id, "assertions", asnErrs);
  }

  state.current_step_id = nextStepId(def, step.id);
  state.status = state.status === "created" ? "in_progress" : state.status;
  state.updated_at = nowISO();

  return advance(def, state, registry);
}

// ── Internal: active-call handling ──

/**
 * Execute one turn of delegating to the in-flight child. Returns a
 * result to propagate, or `undefined` when the child finished and the
 * parent should continue its own loop.
 */
function advanceActiveCall(
  def: WorkflowV1Def,
  state: V1InstanceState,
  registry: V1WorkflowRegistry | undefined,
  autoCompleted: string[],
): AdvanceResult | undefined {
  if (!state.active_call) return undefined;
  if (!registry) {
    return errorResult(state, autoCompleted, new V1RunnerError(
      "active call present but no workflow registry provided",
    ));
  }
  const { child, child_workflow_name, step_id } = state.active_call;
  const childDef = registry.load(child_workflow_name);
  if (!childDef) {
    return errorResult(state, autoCompleted, new V1RunnerError(
      `active call references unknown workflow '${child_workflow_name}'`,
    ));
  }

  const childResult = advance(childDef, child, registry);
  if (childResult.kind === "awaiting_agent") {
    return {
      kind: "awaiting_agent",
      pendingStep: childResult.pendingStep,
      autoCompleted,
    };
  }
  if (childResult.kind === "error") {
    return errorResult(state, autoCompleted, childResult.error!);
  }

  // Child completed: collect its output, stamp it on this call step, advance.
  try {
    const output = collectWorkflowOutput(childDef, child, step_id);
    finishStep(state, step_id, output);
    state.active_call = undefined;
    state.current_step_id = nextStepId(def, step_id);
    state.status = state.status === "created" ? "in_progress" : state.status;
    state.updated_at = nowISO();
    autoCompleted.push(step_id);
    return undefined; // signal: continue parent loop
  } catch (err) {
    const e = err instanceof V1CallError ? err : err as Error;
    return errorResult(state, autoCompleted, e);
  }
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

function finishStep(
  state: V1InstanceState,
  stepId: string,
  output: Record<string, unknown>,
): void {
  const stepState = state.steps[stepId];
  if (!stepState) return;
  stepState.status = "completed";
  stepState.output = output;
  stepState.completed_at = nowISO();
  stepState.iterations = (stepState.iterations ?? 0) + 1;
  state.last_completed_step_id = stepId;
}

/**
 * Undo a finishStep: used when a post-completion `assertions:` rule
 * fails and the agent needs to retry. Output is cleared, status is
 * set back to in_progress, the iteration counter is decremented so
 * the retry doesn't artificially inflate the count.
 */
function revertStep(state: V1InstanceState, stepId: string): void {
  const stepState = state.steps[stepId];
  if (!stepState) return;
  stepState.status = "in_progress";
  stepState.output = undefined;
  stepState.completed_at = undefined;
  if (stepState.iterations && stepState.iterations > 0) {
    stepState.iterations -= 1;
  }
  // last_completed_step_id may now point at this step; back it up to
  // the prior completed step so collectWorkflowOutput stays accurate.
  if (state.last_completed_step_id === stepId) {
    state.last_completed_step_id = priorCompletedId(state, stepId) ?? null;
  }
}

function priorCompletedId(state: V1InstanceState, stepId: string): string | undefined {
  // Best-effort: search instance steps for any other completed step.
  // This is only used for collectWorkflowOutput when a revert pulls
  // last_completed_step_id off the reverted step.
  let mostRecent: { id: string; at: string } | undefined;
  for (const [id, ss] of Object.entries(state.steps)) {
    if (id === stepId) continue;
    if (ss.status !== "completed" || !ss.completed_at) continue;
    if (!mostRecent || ss.completed_at > mostRecent.at) {
      mostRecent = { id, at: ss.completed_at };
    }
  }
  return mostRecent?.id;
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

function errorResult(
  state: V1InstanceState,
  autoCompleted: string[],
  error: Error,
): AdvanceResult {
  state.status = "error";
  state.updated_at = nowISO();
  return { kind: "error", autoCompleted, error };
}
