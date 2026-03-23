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
  | "each_has"
  | "verify_source"
  | "script";

export interface AssertionRule {
  field: string;
  op: AssertionOp;
  value?: unknown;
  message?: string;
}

/** @deprecated Use AssertionRule instead */
export type ValidationRule = AssertionRule;

// ── Action / Policy ──

export interface JsActionDef {
  js: string;
}

export interface ShellActionDef {
  shell: string;
  extract?: Record<string, string>;
}

export type ActionDef = JsActionDef | ShellActionDef;

export interface PolicyRule {
  effect: "allow" | "deny";
  commands: string[];
}

export interface PolicyDef {
  mode: "trail" | "enforce";
  default?: "allow" | "deny";
  rules?: PolicyRule[];
}

// ── Workflow Phase ──

export type WorkflowPhase = "draft" | "dev" | "stable";

// ── Workflow Definition (YAML) ──

export interface ParamDef {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: unknown;
  description?: string;
  validation?: AssertionRule[];
}

export interface AccumulateFieldConfig {
  key: string;
}

export interface StepDef {
  id: string;
  type?: "programmatic" | "agentic";
  description?: string;
  instruction?: string;
  depends_on?: string | string[];
  required_output?: string[];
  validation?: AssertionRule[];
  assertions?: AssertionRule[];
  tips?: string[];
  context_in?: Record<string, string>;
  meta?: Record<string, unknown>;
  actions?: ActionDef[];
  accumulate?: Record<string, AccumulateFieldConfig>;
}

export interface WorkflowDef {
  name: string;
  version?: string;
  description?: string;
  phase?: WorkflowPhase;
  params?: Record<string, ParamDef>;
  context?: Record<string, unknown>;
  steps: StepDef[];
  policy?: PolicyDef;
}

// ── Variant Definition ──

export interface VariantDef {
  extends: "base";
  variant: string;
  description?: string;
  phase?: WorkflowPhase;
  params?: Record<string, ParamDef>;
  context?: Record<string, unknown>;
  steps?: Partial<StepDef>[];
  policy?: PolicyDef;
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
  alias?: string;
  workflow_name: string;
  variant?: string;
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

// ── Command Log (Global) ──

export interface CommandLogEntry {
  timestamp: string;
  command: string;
  cwd: string;
  source?: "cli" | "hook" | "instance";
  denied?: boolean;
  error?: boolean;
}

// ── Validation Result ──

export interface ScriptLog {
  field: string;
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  script_logs?: ScriptLog[];
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
  | "step:reset"
  | "action:before_run"
  | "action:completed"
  | "action:failed"
  | "policy:denied";

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
