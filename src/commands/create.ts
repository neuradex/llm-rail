import { appendLog } from "../audit/logger.js";
import { loadWorkflowAny } from "../engine/workflow-any.js";
import { createV1Instance } from "../engine/state-v1.js";
import { validateWorkflowV1Def } from "../engine/workflow-v1.js";
import { buildSchemaRegistry } from "../engine/schemas.js";
import type { SchemaDef, WorkflowV1Def } from "../types-v1.js";

export function runCreate(workflowName: string, rawParams?: string[], variant?: string): void {
  const { def } = loadWorkflowAny(workflowName, variant);
  runCreateV1(def, rawParams || []);
}

function runCreateV1(def: WorkflowV1Def, rawParams: string[]): void {
  const errors = validateWorkflowV1Def(def);
  if (errors.length > 0) {
    console.error("Workflow definition errors:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("\nRun `lrail wf <name> compile` for full diagnostics.");
    process.exit(1);
  }

  const input = parseV1Input(rawParams, def);

  const state = createV1Instance(def, input);
  appendLog(def.name, state.id, "created", undefined, { workflow_name: def.name, format: "v1", input });

  const lines: string[] = [
    `Instance created: ${state.alias} (${state.id})`,
    `Workflow: ${def.name} [v1]`,
  ];
  if (Object.keys(input).length > 0) {
    lines.push("Input:");
    for (const [k, v] of Object.entries(input)) {
      const display = typeof v === "object" ? JSON.stringify(v) : String(v);
      lines.push(`  ${k}: ${display}`);
    }
  }
  const stepIds = def.steps.map((s) => `${s.id}(${s.type})`).join(" → ");
  lines.push(`Steps: ${stepIds}`);
  console.log(lines.join("\n"));
}

/**
 * Parse `--param key=value` flags into a v1 input object, applying
 * defaults from the workflow's input schema and coercing types.
 * Validates the final shape against the schema.
 */
function parseV1Input(
  rawParams: string[],
  def: WorkflowV1Def,
): Record<string, unknown> {
  const inputSchema = def.schemas[def.input];
  if (!inputSchema) {
    console.error(`Workflow input schema '${def.input}' not found in schemas block.`);
    process.exit(1);
  }
  if (inputSchema.type && inputSchema.type !== "object") {
    console.error(`Workflow input schema '${def.input}' must be type 'object'.`);
    process.exit(1);
  }

  const props = inputSchema.properties || {};
  const required = new Set(inputSchema.required || []);

  const input: Record<string, unknown> = {};
  for (const raw of rawParams) {
    const eq = raw.indexOf("=");
    if (eq === -1) {
      console.error(`Invalid --param format: '${raw}' (expected key=value)`);
      process.exit(1);
    }
    const key = raw.slice(0, eq);
    const val = raw.slice(eq + 1);
    input[key] = coerceInputValue(val, props[key]);
  }

  for (const [name, propSchema] of Object.entries(props)) {
    if (name in input) continue;
    if (typeof propSchema !== "object") continue;
    if (propSchema.default !== undefined) {
      input[name] = propSchema.default;
    } else if (required.has(name)) {
      console.error(`Missing required input '${name}' (schema '${def.input}'). Use --param ${name}=...`);
      process.exit(1);
    }
  }

  const { registry, errors: schemaErrors } = buildSchemaRegistry(def.schemas);
  if (schemaErrors.length > 0) {
    console.error("Schema definition errors:");
    for (const e of schemaErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const result = registry.validate(def.input, input);
  if (!result.valid) {
    console.error("Input failed validation against schema:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  return input;
}

function coerceInputValue(raw: string, propSchema: SchemaDef | string | undefined): unknown {
  if (!propSchema || typeof propSchema === "string") return raw;
  switch (propSchema.type) {
    case "integer": {
      const n = Number(raw);
      return Number.isInteger(n) ? n : raw;
    }
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case "boolean":
      return raw === "true" || raw === "1";
    case "object":
    case "array":
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    case "string":
    default:
      return raw;
  }
}
