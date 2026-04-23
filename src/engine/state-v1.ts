import type { WorkflowV1Def } from "../types-v1.js";

// ── Runtime state for a v1 instance ──

export type V1StepStatus = "pending" | "in_progress" | "completed";
export type V1InstanceStatus = "created" | "in_progress" | "completed" | "error";

/**
 * Per-step runtime state. Output is the typed payload returned by the
 * step — validated against the step's `required_output` schema at
 * completion time.
 */
export interface V1StepState {
  status: V1StepStatus;
  output?: Record<string, unknown>;
  completed_at?: string;
  /** Incremented each time the step is (re-)entered via router backward-goto. */
  iterations?: number;
}

/**
 * Records an in-flight child sub-instance during a `call` step's execution.
 * The child's full state is nested here so the parent can pause, hand
 * control to its agent-awaiting descendant, and resume on submit.
 *
 * The child's workflow definition is NOT stored — it is resolved through
 * the V1WorkflowRegistry at each resume. This keeps instance state
 * serializable and cheap, and lets workflow definitions evolve without
 * in-flight instances becoming stale.
 */
export interface ActiveCall {
  /** Step id of the `call` step in the parent workflow. */
  step_id: string;
  /** Child workflow name; resolved via the registry at resume. */
  child_workflow_name: string;
  /** Fully nested child instance state. */
  child: V1InstanceState;
}

/**
 * Runtime state of a v1 workflow instance.
 *
 * Differences from legacy InstanceState:
 * - `context` field removed (v1 has no global store; data flows only via
 *   step outputs and workflow input).
 * - `input` holds the workflow's input payload (validated against the
 *   workflow's `input:` schema at creation time).
 * - `current_step_id` tracks by step id rather than array index — v1
 *   routers can jump to any step, so an index is fragile.
 * - `last_completed_step_id` records the most recently completed step
 *   in any iteration; used by `collectWorkflowOutput` to determine the
 *   workflow's final output when a `call` resolves.
 * - `active_call` nests an in-flight child sub-instance (see ActiveCall).
 */
export interface V1InstanceState {
  id: string;
  alias?: string;
  workflow_name: string;
  format: "v1";
  status: V1InstanceStatus;
  created_at: string;
  updated_at: string;
  current_step_id: string | null;
  last_completed_step_id: string | null;
  steps: Record<string, V1StepState>;
  input: Record<string, unknown>;
  /** Set when this instance was spawned by a `call` step in a parent. */
  parent?: {
    instance_id: string;
    step_id: string;
    depth: number;
  };
  /** Set while a `call` step is waiting for its child to finish. */
  active_call?: ActiveCall;
}

/**
 * Create an initial V1InstanceState with all steps marked pending and the
 * first step in the definition set as current. The runner will advance
 * from there.
 */
export function initialV1State(
  def: WorkflowV1Def,
  id: string,
  alias: string | undefined,
  input: Record<string, unknown>,
  now: string,
  parent?: V1InstanceState["parent"],
): V1InstanceState {
  const steps: V1InstanceState["steps"] = {};
  for (const step of def.steps) {
    steps[step.id] = { status: "pending" };
  }

  const firstStep = def.steps[0]?.id ?? null;

  const state: V1InstanceState = {
    id,
    workflow_name: def.name,
    format: "v1",
    status: "created",
    created_at: now,
    updated_at: now,
    current_step_id: firstStep,
    last_completed_step_id: null,
    steps,
    input,
  };
  if (alias) state.alias = alias;
  if (parent) state.parent = parent;
  return state;
}
