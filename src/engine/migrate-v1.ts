import type {
  AssertionOp,
  AssertionRule,
  ParamDef,
  StepDef,
  WorkflowDef,
} from "../types.js";
import type {
  SchemaDef,
  SchemaJsonType,
  V1ActionDef,
  V1AgenticStep,
  V1ProgrammaticStep,
  V1StepDef,
  WorkflowV1Def,
} from "../types-v1.js";

// ── Result ──

export interface MigrateResult {
  migrated: WorkflowV1Def;
  /** Line-per-entry list of manual work the author must do after migration. */
  todos: string[];
  /** Notes about automatic rewrites that succeeded (for the summary). */
  notes: string[];
}

// ── Public API ──

/**
 * Best-effort legacy → v1 converter. Rewrites what is safely mechanical
 * and flags the rest with TODO entries that the caller renders into the
 * output YAML. The migrated def is guaranteed to round-trip through
 * validateWorkflowV1Def for definitions that only used declarative
 * features; anything imperative (lrail.set/get/goto, accumulate) is
 * left as-is with an accompanying TODO and will fail validation until
 * the author resolves it.
 */
export function migrateLegacyWorkflow(legacy: WorkflowDef): MigrateResult {
  const todos: string[] = [];
  const notes: string[] = [];
  const schemas: Record<string, SchemaDef> = {};

  // --- 1. Input schema from params ---
  const inputSchema = paramsToSchema(legacy.params);
  schemas.Input = inputSchema;

  // --- 2. Per-step output schemas ---
  const stepOutputSchemaNames = new Map<string, string>();
  for (const step of legacy.steps) {
    if (!step.required_output || step.required_output.length === 0) continue;
    const schemaName = `${pascalCase(step.id)}Output`;
    schemas[schemaName] = buildStepOutputSchema(step);
    stepOutputSchemaNames.set(step.id, schemaName);
  }

  // --- 3. Output schema = last step's schema (or a stub) ---
  const lastSchemaName = findLastOutputSchemaName(legacy.steps, stepOutputSchemaNames);
  const outputSchemaName = lastSchemaName ?? "Output";
  if (!lastSchemaName) {
    schemas.Output = { type: "object" };
    todos.push(
      "No step declared a required_output; generated an empty Output schema. Define output: appropriately.",
    );
  }

  // --- 4. Steps ---
  const v1Steps: V1StepDef[] = [];
  for (const step of legacy.steps) {
    const stepType = step.type ?? "agentic";

    if (step.accumulate) {
      todos.push(
        `Step '${step.id}': accumulate{} is removed in v1. Redesign as recursive call with input buffer (see RFC §8.2).`,
      );
    }

    const migrated =
      stepType === "agentic"
        ? migrateAgenticStep(step, stepOutputSchemaNames, todos)
        : migrateProgrammaticStep(step, stepOutputSchemaNames, todos);
    v1Steps.push(migrated);
  }

  if (legacy.tools) {
    todos.push(
      "Workflow had a `tools:` block; v1 tool execution is unchanged but schemas should be added. Review manually.",
    );
  }

  const migrated: WorkflowV1Def = {
    format: "v1",
    name: legacy.name,
    schemas,
    input: "Input",
    output: outputSchemaName,
    steps: v1Steps,
  };
  if (legacy.version) migrated.version = legacy.version;
  if (legacy.description) migrated.description = legacy.description;
  if (legacy.phase) migrated.phase = legacy.phase;
  if (legacy.policy) migrated.policy = legacy.policy;
  if (legacy.tools) migrated.tools = legacy.tools;

  notes.push(`Generated ${Object.keys(schemas).length} schema(s)`);
  notes.push(`Migrated ${v1Steps.length} step(s)`);

  return { migrated, todos, notes };
}

// ── Input schema from params ──

function paramsToSchema(params: Record<string, ParamDef> | undefined): SchemaDef {
  if (!params) return { type: "object" };
  const properties: Record<string, SchemaDef> = {};
  const required: string[] = [];
  for (const [name, p] of Object.entries(params)) {
    const prop: SchemaDef = { type: paramTypeToSchemaType(p.type) };
    if (p.description) prop.description = p.description;
    if (p.default !== undefined) prop.default = p.default;
    properties[name] = prop;
    if (p.required) required.push(name);
  }
  const s: SchemaDef = { type: "object", properties };
  if (required.length > 0) s.required = required;
  return s;
}

function paramTypeToSchemaType(t: ParamDef["type"]): SchemaJsonType {
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  return "string";
}

// ── Per-step output schemas ──

function buildStepOutputSchema(step: StepDef): SchemaDef {
  const properties: Record<string, SchemaDef> = {};
  const required: string[] = [];
  for (const field of step.required_output ?? []) {
    properties[field] = inferFieldSchema(step.validation, field);
    required.push(field);
  }
  const s: SchemaDef = { type: "object" };
  if (Object.keys(properties).length > 0) s.properties = properties;
  if (required.length > 0) s.required = required;
  return s;
}

/**
 * Fold validation rules that map onto JSON Schema subset keywords into
 * a field's schema. Non-structural rules (script, verify_source,
 * cross-field) are left in the legacy validation block (not carried
 * to v1 — caller surfaces them as TODOs).
 */
function inferFieldSchema(
  rules: AssertionRule[] | undefined,
  field: string,
): SchemaDef {
  const schema: SchemaDef = {};
  if (!rules) return schema;
  for (const rule of rules) {
    if (rule.field !== field) continue;
    foldRuleIntoSchema(rule, schema);
  }
  return schema;
}

const STRUCTURAL_OPS = new Set<AssertionOp>([
  "type",
  "min_length",
  "max_length",
  "length",
  "min",
  "max",
  "one_of",
  "not_empty",
]);

function foldRuleIntoSchema(rule: AssertionRule, schema: SchemaDef): void {
  const val = rule.value;
  switch (rule.op) {
    case "type": {
      const t = String(val);
      if (t === "array" || t === "object" || t === "string" || t === "number" || t === "integer" || t === "boolean") {
        schema.type = t;
      }
      return;
    }
    case "min_length":
      if (schema.type === "string") schema.minLength = Number(val);
      else schema.minItems = Number(val);
      return;
    case "max_length":
      if (schema.type === "string") schema.maxLength = Number(val);
      else schema.maxItems = Number(val);
      return;
    case "length":
      if (schema.type === "string") {
        schema.minLength = Number(val);
        schema.maxLength = Number(val);
      } else {
        schema.minItems = Number(val);
        schema.maxItems = Number(val);
      }
      return;
    case "min":
      schema.minimum = Number(val);
      return;
    case "max":
      schema.maximum = Number(val);
      return;
    case "one_of":
      if (Array.isArray(val)) schema.enum = val;
      return;
    case "not_empty":
      // Expressed as schema.required on the parent object, not here;
      // but if this is a string/array, minLength/minItems 1 is the
      // natural translation.
      if (schema.type === "string") schema.minLength = Math.max(schema.minLength ?? 0, 1);
      else if (schema.type === "array") schema.minItems = Math.max(schema.minItems ?? 0, 1);
      return;
  }
}

function isStructural(rule: AssertionRule): boolean {
  return STRUCTURAL_OPS.has(rule.op);
}

// ── Last step output → workflow output ──

function findLastOutputSchemaName(
  steps: StepDef[],
  map: Map<string, string>,
): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const name = map.get(steps[i].id);
    if (name) return name;
  }
  return undefined;
}

// ── Agentic step ──

function migrateAgenticStep(
  step: StepDef,
  stepSchemas: Map<string, string>,
  todos: string[],
): V1AgenticStep {
  const schemaName = stepSchemas.get(step.id);
  if (!schemaName) {
    todos.push(
      `Agentic step '${step.id}' has no required_output; v1 requires one. Define a schema and reference it.`,
    );
  }
  const instruction = appendTipsAsComment(step.instruction ?? "", step.tips);

  const out: V1AgenticStep = {
    id: step.id,
    type: "agentic",
    instruction,
    required_output: schemaName ?? "Output",
  };
  if (step.description) out.description = step.description;
  if (step.context_in) out.context_in = { ...step.context_in };
  if (step.meta) out.meta = { ...step.meta };
  if (step.timeout_ms !== undefined) out.timeout_ms = step.timeout_ms;

  // Residual (non-structural) validation survives as v1 assertions.
  const residual = (step.validation ?? []).filter((r) => !isStructural(r));
  if (residual.length > 0) {
    out.validation = residual;
    if (residual.some((r) => r.op === "script" || r.op === "verify_source")) {
      todos.push(
        `Agentic step '${step.id}': non-structural validation rules preserved verbatim. Review whether they still apply.`,
      );
    }
  }
  if (step.assertions) out.assertions = step.assertions;

  return out;
}

// ── Programmatic step ──

function migrateProgrammaticStep(
  step: StepDef,
  stepSchemas: Map<string, string>,
  todos: string[],
): V1ProgrammaticStep {
  const actions: V1ActionDef[] = [];
  for (let i = 0; i < (step.actions ?? []).length; i++) {
    const raw = step.actions![i] as unknown as Record<string, unknown>;
    const js = typeof raw.js === "string" ? raw.js : undefined;
    const shell = typeof raw.shell === "string" ? raw.shell : undefined;

    if (js && /lrail\.(get|set|goto)\s*\(/.test(js)) {
      todos.push(
        `Step '${step.id}' action[${i}]: uses lrail.${matchPrimitive(js)} — v1 forbids these. Rewrite using return values, context_in, and router steps.`,
      );
    }

    const existingName = typeof raw.name === "string" ? raw.name : undefined;
    const existingDesc = typeof raw.description === "string" ? raw.description : undefined;
    const action: V1ActionDef = {
      name: existingName?.trim() ? existingName : `action${i + 1}`,
      description: existingDesc?.trim()
        ? existingDesc
        : `(TODO: add description — was auto-generated during migration)`,
    };
    if (js) action.js = js;
    if (shell) action.shell = shell;
    if (typeof raw.extract === "object" && raw.extract !== null) {
      action.extract = raw.extract as Record<string, string>;
    }
    actions.push(action);
  }
  if (actions.length === 0) {
    todos.push(`Programmatic step '${step.id}': no actions after migration. Add at least one.`);
  }

  const out: V1ProgrammaticStep = {
    id: step.id,
    type: "programmatic",
    actions,
  };
  const schemaName = stepSchemas.get(step.id);
  if (schemaName) out.required_output = schemaName;
  if (step.description) out.description = step.description;
  if (step.context_in) out.context_in = { ...step.context_in };
  if (step.meta) out.meta = { ...step.meta };
  if (step.timeout_ms !== undefined) out.timeout_ms = step.timeout_ms;

  const residual = (step.validation ?? []).filter((r) => !isStructural(r));
  if (residual.length > 0) out.validation = residual;
  if (step.assertions) out.assertions = step.assertions;

  return out;
}

function matchPrimitive(js: string): string {
  if (/lrail\.goto\s*\(/.test(js)) return "goto";
  if (/lrail\.set\s*\(/.test(js)) return "set";
  return "get";
}

// ── Helpers ──

function appendTipsAsComment(instruction: string, tips: string[] | undefined): string {
  if (!tips || tips.length === 0) return instruction;
  const note = tips.map((t) => `  - ${t}`).join("\n");
  return `${instruction}\n\n(Migrated tips — review and inline as needed:\n${note}\n)`;
}

function pascalCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .map((p) => (p.length === 0 ? "" : p[0].toUpperCase() + p.slice(1)))
    .join("");
}
