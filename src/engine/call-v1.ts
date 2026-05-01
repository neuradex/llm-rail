import { generateId, nowISO } from "../util.js";
import type { V1CallStep, WorkflowV1Def } from "../types-v1.js";
import { resolveReference } from "./context-v1.js";
import { buildSchemaRegistry } from "./schemas.js";
import { initialV1State, type V1InstanceState } from "./state-v1.js";

// ── Registry ──

/**
 * Resolves a workflow name to its definition. Implementations vary:
 *   - In-memory for tests.
 *   - Filesystem-backed for the CLI (scans LRAIL_DATA or equivalent).
 * Missing names return undefined, not throw, so handleCall can surface
 * a specific error.
 */
export interface V1WorkflowRegistry {
  load(name: string): WorkflowV1Def | undefined;
}

/** Convenience registry for tests: plain object keyed by workflow name. */
export function makeInMemoryRegistry(
  entries: Record<string, WorkflowV1Def>,
): V1WorkflowRegistry {
  return {
    load(name) {
      return entries[name];
    },
  };
}

// ── Errors ──

export class V1CallError extends Error {
  constructor(
    public readonly stepId: string,
    message: string,
  ) {
    super(`Call step '${stepId}': ${message}`);
    this.name = "V1CallError";
  }
}

// ── Config ──

export const DEFAULT_MAX_DEPTH = 100;

// ── Spawn ──

/**
 * Initialize an `active_call` on the parent state: resolves child
 * workflow, maps inputs, validates against the child's input schema,
 * enforces `max_depth`, and creates the nested child instance state.
 *
 * Does NOT advance the child. The caller (runner) delegates execution
 * via `delegateActiveCall`.
 */
export function beginCall(
  step: V1CallStep,
  parent: V1InstanceState,
  registry: V1WorkflowRegistry,
): void {
  const childDef = registry.load(step.workflow);
  if (!childDef) {
    throw new V1CallError(step.id, `unknown workflow '${step.workflow}'`);
  }

  // Depth accounting. Root instance has parent === undefined (depth 0).
  // A call descending one level becomes depth = parent.depth + 1.
  const parentDepth = parent.parent?.depth ?? 0;
  const nextDepth = parentDepth + 1;
  const maxDepth = childDef.max_depth ?? DEFAULT_MAX_DEPTH;
  if (nextDepth > maxDepth) {
    throw new V1CallError(
      step.id,
      `max_depth ${maxDepth} exceeded (attempted depth ${nextDepth})`,
    );
  }

  // Map inputs from parent state.
  const childInput: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(step.inputs)) {
    childInput[key] = resolveReference(step.id, `inputs.${key}`, template, parent);
  }

  // Validate against the child's declared input schema.
  const { registry: childSchemaRegistry, errors: schemaErrors } =
    buildSchemaRegistry(childDef.schemas);
  if (schemaErrors.length > 0) {
    throw new V1CallError(
      step.id,
      `child workflow '${step.workflow}' has schema errors: ${schemaErrors.join("; ")}`,
    );
  }
  const inputCheck = childSchemaRegistry.validate(childDef.input, childInput);
  if (!inputCheck.valid) {
    throw new V1CallError(
      step.id,
      `inputs fail child's '${childDef.input}' schema: ${inputCheck.errors.join("; ")}`,
    );
  }

  const childState = initialV1State(
    childDef,
    generateId(),
    undefined,
    childInput,
    nowISO(),
    {
      instance_id: parent.id,
      step_id: step.id,
      depth: nextDepth,
    },
  );

  parent.active_call = {
    step_id: step.id,
    child_workflow_name: step.workflow,
    child: childState,
  };
}

// ── Output collection ──

/**
 * Extract the child workflow's final output. Convention: the output is
 * whatever the last completed step produced. This matches the RFC's
 * example workflows, where a trailing programmatic step shapes the
 * declared `output:` schema from accumulated fields.
 *
 * The result is validated against the child's `output:` schema so a
 * misbehaving workflow surfaces a V1CallError to the caller rather than
 * silently returning ill-shaped data.
 */
export function collectWorkflowOutput(
  def: WorkflowV1Def,
  state: V1InstanceState,
  callStepId: string,
): Record<string, unknown> {
  const finalId = state.last_completed_step_id;
  if (!finalId) {
    throw new V1CallError(
      callStepId,
      `child workflow '${def.name}' completed without any step output`,
    );
  }
  const finalState = state.steps[finalId];
  const output = finalState?.output;
  if (!output) {
    throw new V1CallError(
      callStepId,
      `child workflow '${def.name}' last step '${finalId}' has no output`,
    );
  }

  const { registry } = buildSchemaRegistry(def.schemas);
  const check = registry.validate(def.output, output);
  if (!check.valid) {
    throw new V1CallError(
      callStepId,
      `child workflow '${def.name}' output does not match '${def.output}' schema: ${check.errors.join("; ")}`,
    );
  }

  return output;
}
