// ── Assertion ──

export type AssertionOp =
  | "exists"
  | "not_empty"
  | "type"
  | "min_length"
  | "max_length"
  | "length"
  | "min"
  | "max"
  | "between"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "matches"
  | "one_of"
  | "each_has";

export interface AssertionRule {
  field: string;
  op: AssertionOp;
  value?: unknown;
  message?: string;
}

/** @deprecated Use AssertionRule instead */
export type ValidationRule = AssertionRule;

// ── Workflow Definition (YAML) ──

export interface ParamDef {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: unknown;
  description?: string;
  validation?: AssertionRule[];
}

export interface StepDef {
  id: string;
  description: string;
  depends_on?: string | string[];
  required_output: string[];
  validation?: AssertionRule[];
  assertions?: AssertionRule[];
  tips?: string[];
  context_in?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export interface WorkflowDef {
  name: string;
  version?: string;
  description?: string;
  params?: Record<string, ParamDef>;
  context?: Record<string, unknown>;
  steps: StepDef[];
}

// ── Instance State (runtime YAML) ──

export type StepStatus = "pending" | "in_progress" | "completed";
export type InstanceStatus = "created" | "in_progress" | "completed" | "error";

export interface StepState {
  status: StepStatus;
  output?: Record<string, unknown>;
  completed_at?: string;
}

export interface InstanceState {
  id: string;
  workflow_name: string;
  status: InstanceStatus;
  created_at: string;
  updated_at: string;
  current_step: number;
  steps: Record<string, StepState>;
  context: Record<string, unknown>;
  params?: Record<string, unknown>;
}

// ── Audit Log ──

export interface AuditEntry {
  timestamp: string;
  instance_id: string;
  event: string;
  step_id?: string;
  data?: Record<string, unknown>;
}

// ── Validation Result ──

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Hooks ──

export type HookEvent =
  | "workflow:created"
  | "workflow:completed"
  | "workflow:error"
  | "step:before_start"
  | "step:started"
  | "step:before_complete"
  | "step:completed"
  | "step:rejected"
  | "step:reset";

export interface HookPayload {
  event: HookEvent;
  instance_id: string;
  workflow_name: string;
  step_id?: string;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface HookResult {
  allow: boolean;
  message?: string;
}
