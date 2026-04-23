import type { AssertionRule } from "../types.js";
import type { CaseDef, V1RouterStep, WhenExpr } from "../types-v1.js";
import { applyRule } from "./validator.js";
import type { V1InstanceState } from "./state-v1.js";

// ── Errors ──

export class RouterResolutionError extends Error {
  constructor(
    public readonly stepId: string,
    reason: string,
  ) {
    super(`Router '${stepId}': ${reason}`);
    this.name = "RouterResolutionError";
  }
}

// ── Evaluation result ──

export interface RouterDecision {
  /** Selected target step id. */
  goto: string;
  /**
   * Index into `cases` if a case matched; -1 if the default fired.
   */
  case_index: number;
  /** True iff the default fired (no case matched). */
  used_default: boolean;
}

/**
 * Evaluate a router and produce its routing decision.
 *
 * Rules:
 *  - `cases` are evaluated in order; the first matching case wins.
 *  - If no case matches, `default` is used.
 *  - Field references in `when.field` (and, where it looks like a reference,
 *    in `when.value`) are resolved against the router's own context_in
 *    locals, prior step outputs, and workflow input — in that order.
 */
export function evaluateRouter(
  step: V1RouterStep,
  routerContext: Record<string, unknown>,
  state: V1InstanceState,
): RouterDecision {
  for (let i = 0; i < step.cases.length; i++) {
    const c = step.cases[i];
    if (evaluateWhen(c.when, routerContext, state, step.id)) {
      return { goto: c.goto, case_index: i, used_default: false };
    }
  }
  return { goto: step.default, case_index: -1, used_default: true };
}

// ── when expression ──

export function evaluateWhen(
  when: WhenExpr,
  routerContext: Record<string, unknown>,
  state: V1InstanceState,
  stepId: string,
): boolean {
  // Array of rules → implicit AND
  if (Array.isArray(when)) {
    return when.every((w) => evaluateWhen(w as WhenExpr, routerContext, state, stepId));
  }

  // Combinator objects (must come before AssertionRule test since
  // combinators are also plain objects).
  if (isAll(when)) {
    return when.all.every((w) => evaluateWhen(w, routerContext, state, stepId));
  }
  if (isAny(when)) {
    return when.any.some((w) => evaluateWhen(w, routerContext, state, stepId));
  }
  if (isNot(when)) {
    return !evaluateWhen(when.not, routerContext, state, stepId);
  }

  // Single AssertionRule
  return evaluateRule(when as AssertionRule, routerContext, state, stepId);
}

function evaluateRule(
  rule: AssertionRule,
  routerContext: Record<string, unknown>,
  state: V1InstanceState,
  stepId: string,
): boolean {
  const value = resolveValue(rule.field, routerContext, state, stepId);
  const expected = resolveMaybeReference(rule.value, routerContext, state, stepId);
  const err = applyRule({ ...rule, value: expected }, value);
  return err === null;
}

// ── Reference resolution ──

/**
 * Resolve a "field" position, which in a router is always a reference
 * template. Supports three forms:
 *   {step.field}   — prior step output
 *   {{name}}       — router's own context_in local (if set),
 *                    else workflow input
 *   <literal>      — rejected (routers don't read unscoped keys)
 *
 * Dotted paths are traversed. A lookup that cannot resolve throws, rather
 * than silently comparing against undefined.
 */
function resolveValue(
  ref: string,
  routerContext: Record<string, unknown>,
  state: V1InstanceState,
  stepId: string,
): unknown {
  const stepRef = ref.match(/^\{([\w-]+)\.([\w.-]+)\}$/);
  if (stepRef) {
    const [, sourceStep, fieldPath] = stepRef;
    const source = state.steps[sourceStep];
    if (!source) {
      throw new RouterResolutionError(
        stepId,
        `when.field references unknown step '${sourceStep}'`,
      );
    }
    if (source.status !== "completed" || !source.output) {
      throw new RouterResolutionError(
        stepId,
        `when.field references step '${sourceStep}' that has not completed`,
      );
    }
    return traversePath(source.output, fieldPath, (reason) => {
      throw new RouterResolutionError(stepId, `when.field ${ref}: ${reason}`);
    });
  }

  const inputRef = ref.match(/^\{\{([\w.-]+)\}\}$/);
  if (inputRef) {
    const [, fieldPath] = inputRef;
    const root = fieldPath.split(".")[0];
    if (root in routerContext) {
      return traversePath(routerContext, fieldPath, (reason) => {
        throw new RouterResolutionError(stepId, `when.field ${ref}: ${reason}`);
      });
    }
    return traversePath(state.input, fieldPath, (reason) => {
      throw new RouterResolutionError(stepId, `when.field ${ref}: ${reason}`);
    });
  }

  throw new RouterResolutionError(
    stepId,
    `when.field '${ref}' is not a valid reference (expected "{step.field}" or "{{name}}")`,
  );
}

/**
 * If `raw` looks like a reference template, resolve it. Otherwise return
 * the literal (so rules like `{ op: eq, value: "x" }` still work).
 */
function resolveMaybeReference(
  raw: unknown,
  routerContext: Record<string, unknown>,
  state: V1InstanceState,
  stepId: string,
): unknown {
  if (typeof raw !== "string") return raw;
  if (/^\{[\w-]+\.[\w.-]+\}$/.test(raw) || /^\{\{[\w.-]+\}\}$/.test(raw)) {
    return resolveValue(raw, routerContext, state, stepId);
  }
  return raw;
}

// ── Combinator type guards ──

function isAll(w: WhenExpr): w is { all: WhenExpr[] } {
  return typeof w === "object" && w !== null && !Array.isArray(w) && "all" in w;
}
function isAny(w: WhenExpr): w is { any: WhenExpr[] } {
  return typeof w === "object" && w !== null && !Array.isArray(w) && "any" in w;
}
function isNot(w: WhenExpr): w is { not: WhenExpr } {
  return typeof w === "object" && w !== null && !Array.isArray(w) && "not" in w;
}

// ── Helpers ──

function traversePath(
  root: unknown,
  fieldPath: string,
  fail: (reason: string) => never,
): unknown {
  const parts = fieldPath.split(".");
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) {
      fail(`path traverses a null/undefined at '${part}'`);
    }
    if (typeof cur !== "object" || Array.isArray(cur)) {
      fail(`path traverses a non-object at '${part}'`);
    }
    const obj = cur as Record<string, unknown>;
    if (!(part in obj)) {
      fail(`field '${part}' not found`);
    }
    cur = obj[part];
  }
  return cur;
}

// ── Goto application ──

export interface GotoApplyResult {
  /** True when the goto walked backwards (target is at or before the router). */
  backward: boolean;
  /** Step ids whose state was reset because they fall in the (target..router] window. */
  resetStepIds: string[];
  /** New iteration count for this router if backward; undefined otherwise. */
  newIterations?: number;
}

/**
 * Apply a router decision to the instance state.
 *
 * Forward goto: just set current_step_id; no reset (prior outputs remain
 * available to the target and beyond).
 *
 * Backward goto: reset outputs of every step in [target, routerId] window
 * (inclusive) so a fresh loop iteration starts clean. The router's own
 * iteration counter increments; if `max_iterations` would be exceeded,
 * throws.
 */
export function applyRouterGoto(
  step: V1RouterStep,
  target: string,
  stepOrder: string[],
  state: V1InstanceState,
): GotoApplyResult {
  const routerIdx = stepOrder.indexOf(step.id);
  const targetIdx = stepOrder.indexOf(target);
  if (routerIdx === -1) {
    throw new RouterResolutionError(step.id, `router step not found in workflow order`);
  }
  if (targetIdx === -1) {
    throw new RouterResolutionError(step.id, `goto target '${target}' not found in workflow`);
  }

  // Forward (target strictly after router): simple jump.
  if (targetIdx > routerIdx) {
    state.current_step_id = target;
    return { backward: false, resetStepIds: [] };
  }

  // Backward (target at or before router): reset the window and bump
  // the router's iteration counter.
  const routerState = state.steps[step.id];
  const newIterations = (routerState?.iterations ?? 0) + 1;
  if (step.max_iterations !== undefined && newIterations > step.max_iterations) {
    throw new RouterResolutionError(
      step.id,
      `max_iterations (${step.max_iterations}) exceeded`,
    );
  }

  const resetIds: string[] = [];
  for (let i = targetIdx; i <= routerIdx; i++) {
    const id = stepOrder[i];
    const s = state.steps[id];
    if (!s) continue;
    s.status = "pending";
    s.output = undefined;
    s.completed_at = undefined;
    resetIds.push(id);
  }

  state.current_step_id = target;

  return { backward: true, resetStepIds: resetIds, newIterations };
}
