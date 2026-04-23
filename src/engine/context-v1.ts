import type { ContextInValue } from "../types-v1.js";
import type { V1InstanceState } from "./state-v1.js";

/**
 * Error thrown when a context_in reference cannot be resolved against the
 * current instance state. The runner surfaces these as step-start failures
 * so they halt execution rather than silently passing `undefined`.
 */
export class ContextResolutionError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly key: string,
    public readonly template: string,
    reason: string,
  ) {
    super(`Step '${stepId}' context_in '${key}' (${template}): ${reason}`);
    this.name = "ContextResolutionError";
  }
}

/**
 * Resolve a single reference template to its underlying value.
 *
 * Supported forms (v1 only admits these two — no string interpolation):
 *   "{stepId.field}"   → state.steps[stepId].output?.[field]
 *   "{{inputName}}"    → state.input[inputName]
 *
 * A reference pointing to a step that has not completed (no output yet)
 * is an error: v1 requires every context_in source to be available when
 * the step starts. The runner's advance order guarantees this *before*
 * router backward-goto; with router, a later PR will additionally check
 * reachability at compile time.
 */
export function resolveReference(
  stepId: string,
  key: string,
  template: string,
  state: V1InstanceState,
): unknown {
  const stepRef = template.match(/^\{([\w-]+)\.([\w.-]+)\}$/);
  if (stepRef) {
    const [, sourceStep, fieldPath] = stepRef;
    const src = state.steps[sourceStep];
    if (!src) {
      throw new ContextResolutionError(
        stepId, key, template,
        `source step '${sourceStep}' does not exist`,
      );
    }
    if (src.status !== "completed" || !src.output) {
      throw new ContextResolutionError(
        stepId, key, template,
        `source step '${sourceStep}' has not completed`,
      );
    }
    return traversePath(src.output, fieldPath, (reason) => {
      throw new ContextResolutionError(stepId, key, template, reason);
    });
  }

  const inputRef = template.match(/^\{\{([\w.-]+)\}\}$/);
  if (inputRef) {
    const [, fieldPath] = inputRef;
    return traversePath(state.input, fieldPath, (reason) => {
      throw new ContextResolutionError(stepId, key, template, reason);
    });
  }

  throw new ContextResolutionError(
    stepId, key, template,
    `malformed reference (expected "{step.field}" or "{{input.field}}")`,
  );
}

/**
 * Build a step's runtime context by resolving every entry in its
 * context_in mapping. Accepts both string (`"{step.f}"`) and object
 * (`{ from: "{step.f}", type: "SchemaName" }`) forms. The `type` hint
 * is discarded here — static compatibility is a compile concern.
 */
export function buildStepContextV1(
  stepId: string,
  contextIn: Record<string, ContextInValue> | undefined,
  state: V1InstanceState,
): Record<string, unknown> {
  if (!contextIn) return {};
  const ctx: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(contextIn)) {
    const template = typeof value === "string" ? value : value.from;
    ctx[key] = resolveReference(stepId, key, template, state);
  }
  return ctx;
}

/**
 * Collect every prior step's output. Used by `router` (PR #3) to evaluate
 * `when` expressions against state beyond what a step's context_in covers.
 */
export function collectStepOutputs(
  state: V1InstanceState,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, s] of Object.entries(state.steps)) {
    if (s.output) out[id] = s.output;
  }
  return out;
}

// ── Internal ──

function traversePath(
  root: Record<string, unknown>,
  fieldPath: string,
  fail: (reason: string) => never,
): unknown {
  const parts = fieldPath.split(".");
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) {
      fail(`path '${fieldPath}' traverses a null/undefined value at '${part}'`);
    }
    if (typeof cur !== "object" || Array.isArray(cur)) {
      fail(`path '${fieldPath}' traverses a non-object at '${part}'`);
    }
    const obj = cur as Record<string, unknown>;
    if (!(part in obj)) {
      fail(`field '${part}' not found in '${fieldPath}'`);
    }
    cur = obj[part];
  }
  return cur;
}
