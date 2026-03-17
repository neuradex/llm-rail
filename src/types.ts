// ── Workflow Definition (YAML) ──

export interface ValidationRule {
  field: string;
  op: "min_length" | "min" | "max" | "exists" | "type";
  value: string | number;
}

export interface StepDef {
  id: string;
  description: string;
  depends_on?: string;
  required_output: string[];
  validation?: ValidationRule[];
  tips?: string[];
}

export interface WorkflowDef {
  name: string;
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
