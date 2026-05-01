import type {
  AssertionRule,
  PolicyDef,
  ToolDef,
  WorkflowPhase,
} from "./types.js";

// ── Schema (JSON Schema 2020-12 minimal subset) ──

export type SchemaJsonType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean";

/**
 * Reference to a named schema declared in the workflow's `schemas:` block.
 * The value is the schema's name (e.g. "Input", "Record").
 */
export type SchemaRef = string;

/**
 * A value used where a schema is expected — either an inline subschema
 * (only allowed *inside* a schema definition, never at reference points
 * like `input:`, `output:`, `required_output:`) or a named reference.
 */
export type SchemaOrRef = SchemaDef | SchemaRef;

/**
 * Schema definition. Tracks the JSON Schema 2020-12 minimal subset adopted
 * by RFC 0001. Keywords outside this set are rejected by the schema validator.
 */
export interface SchemaDef {
  type?: SchemaJsonType;
  properties?: Record<string, SchemaOrRef>;
  required?: string[];
  additionalProperties?: boolean | SchemaOrRef;
  items?: SchemaOrRef;
  enum?: unknown[];
  const?: unknown;
  oneOf?: SchemaOrRef[];
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  description?: string;
}

// ── context_in ──

/**
 * A context_in entry. Either a template string (`"{step.field}"` or
 * `"{{paramName}}"`) or an object form giving an explicit type hint
 * and/or default value. The default is used when the referenced step
 * has not completed (e.g. skipped by a forward goto, or absent in a
 * recursive base case).
 */
export type ContextInValue =
  | string
  | { from: string; type?: SchemaRef; default?: unknown };

// ── Actions (v1) ──

/**
 * v1 actions require `name` and `description`. Exactly one of `js` or
 * `shell` must be set. `extract` is only valid with `shell`.
 */
export interface V1ActionDef {
  name: string;
  description: string;
  js?: string;
  shell?: string;
  extract?: Record<string, string>;
}

// ── Router ──

/**
 * A when-expression for router cases. May be:
 * - an AssertionRule (single condition)
 * - an array of AssertionRules (implicit AND)
 * - a combinator object: { all: [...] } | { any: [...] } | { not: expr }
 */
export type WhenExpr =
  | AssertionRule
  | AssertionRule[]
  | { all: WhenExpr[] }
  | { any: WhenExpr[] }
  | { not: WhenExpr };

export interface CaseDef {
  when: WhenExpr;
  goto: string;
}

// ── Step Types (v1) ──

export interface V1AgenticStep {
  id: string;
  type: "agentic";
  description?: string;
  instruction: string;
  context_in?: Record<string, ContextInValue>;
  required_output: SchemaRef;
  validation?: AssertionRule[];
  assertions?: AssertionRule[];
  meta?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface V1ProgrammaticStep {
  id: string;
  type: "programmatic";
  description?: string;
  context_in?: Record<string, ContextInValue>;
  required_output?: SchemaRef;
  actions: V1ActionDef[];
  validation?: AssertionRule[];
  assertions?: AssertionRule[];
  meta?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface V1RouterStep {
  id: string;
  type: "router";
  description?: string;
  context_in?: Record<string, ContextInValue>;
  cases: CaseDef[];
  default: string;
  max_iterations?: number;
  meta?: Record<string, unknown>;
}

export interface V1CallStep {
  id: string;
  type: "call";
  description?: string;
  workflow: string;
  inputs: Record<string, string>;
  meta?: Record<string, unknown>;
}

export type V1StepDef =
  | V1AgenticStep
  | V1ProgrammaticStep
  | V1RouterStep
  | V1CallStep;

// ── Workflow (v1) ──

/**
 * The `format` marker distinguishes v1 workflows from legacy ones.
 * A workflow is parsed by the v1 engine iff `format === "v1"`.
 */
export const V1_FORMAT_MARKER = "v1" as const;

export interface WorkflowV1Def {
  format: typeof V1_FORMAT_MARKER;
  name: string;
  version?: string;
  description?: string;
  phase?: WorkflowPhase;

  /** Named schemas. All references (input/output/required_output/items/etc.) resolve here. */
  schemas: Record<string, SchemaDef>;

  /** Workflow-level input schema (name reference). */
  input: SchemaRef;
  /** Workflow-level output schema (name reference). */
  output: SchemaRef;

  /** Recursion depth limit for `call` steps that may recurse (default 100). */
  max_depth?: number;

  tools?: Record<string, ToolDef>;
  policy?: PolicyDef;
  steps: V1StepDef[];
}

// ── Type guards ──

export function isV1Workflow(def: unknown): def is WorkflowV1Def {
  return (
    typeof def === "object" &&
    def !== null &&
    (def as { format?: unknown }).format === V1_FORMAT_MARKER
  );
}

export function isAgenticStep(step: V1StepDef): step is V1AgenticStep {
  return step.type === "agentic";
}

export function isProgrammaticStep(step: V1StepDef): step is V1ProgrammaticStep {
  return step.type === "programmatic";
}

export function isRouterStep(step: V1StepDef): step is V1RouterStep {
  return step.type === "router";
}

export function isCallStep(step: V1StepDef): step is V1CallStep {
  return step.type === "call";
}
