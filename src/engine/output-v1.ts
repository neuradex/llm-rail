import {
  isAgenticStep,
  isCallStep,
  isProgrammaticStep,
  isRouterStep,
  type SchemaDef,
  type V1AgenticStep,
  type V1StepDef,
  type WorkflowV1Def,
} from "../types-v1.js";
import type { V1InstanceState } from "./state-v1.js";
import { buildSchemaRegistry } from "./schemas.js";

const SEPARATOR = "────────────────────────────────────────";

const aliasOrId = (state: V1InstanceState) => state.alias || state.id;

/**
 * Resolve `{{name}}` and `{{a.b}}` templates inside a string against
 * the merged scope of (resolved context_in) ∪ (workflow input).
 * Unknown names are left in place so the agent can spot them.
 */
function interpolate(
  template: string,
  scope: Record<string, unknown>,
): string {
  return template.replace(/\{\{([\w.-]+)\}\}/g, (_match, expr: string) => {
    const parts = expr.split(".");
    let cur: unknown = scope;
    for (const p of parts) {
      if (cur === null || cur === undefined) return `{{${expr}}}`;
      if (typeof cur !== "object" || Array.isArray(cur)) return `{{${expr}}}`;
      cur = (cur as Record<string, unknown>)[p];
    }
    if (cur === undefined) return `{{${expr}}}`;
    if (typeof cur === "object") return JSON.stringify(cur);
    return String(cur);
  });
}

/**
 * Render the prompt shown when execution pauses at an agentic step.
 * Includes the resolved context_in, the schema-derived field list, and
 * the exact `next` command the agent should run.
 */
export function formatV1AgenticStart(
  def: WorkflowV1Def,
  state: V1InstanceState,
  pendingStep: V1AgenticStep,
  resolvedContext: Record<string, unknown>,
): string {
  const stepIds = def.steps.map((s) => s.id);
  const stepNum = stepIds.indexOf(pendingStep.id) + 1;
  const total = stepIds.length;
  const headerLabel = pendingStep.description || pendingStep.id;
  const exampleResult = buildExampleResult(def, pendingStep.required_output);
  const interpScope = { ...state.input, ...resolvedContext };
  const resolvedInstruction = interpolate(pendingStep.instruction.trim(), interpScope);

  const lines: string[] = [
    SEPARATOR,
    `Step ${stepNum}/${total}: ${headerLabel}`,
    "",
    `Required output schema: ${pendingStep.required_output}`,
  ];

  const fields = describeSchemaFields(def, pendingStep.required_output);
  if (fields) {
    lines.push(`  Fields: ${fields}`);
  }

  if (Object.keys(resolvedContext).length > 0) {
    lines.push("", "Context:");
    for (const [key, val] of Object.entries(resolvedContext)) {
      const display = typeof val === "object" ? JSON.stringify(val) : String(val);
      lines.push(`  ${key}: ${display}`);
    }
  }

  if (def.tools && Object.keys(def.tools).length > 0) {
    lines.push("", "Available tools:");
    for (const [name, tool] of Object.entries(def.tools)) {
      const paramList = tool.params
        ? Object.entries(tool.params)
            .map(([k, v]) => `${k}${v.required ? "" : "?"}: ${v.type}`)
            .join(", ")
        : "";
      lines.push(`  lrail ${aliasOrId(state)} tool ${name}${paramList ? ` --args '{ ${paramList} }'` : ""}`);
      if (tool.description) lines.push(`    ${tool.description}`);
    }
  }

  lines.push(
    "",
    `>>> NEXT ACTION: ${resolvedInstruction}`,
    `    lrail ${aliasOrId(state)} next --result '${exampleResult}'`,
    "",
    "!!! WARNING: Output must validate against the declared schema, or it will be rejected.",
    SEPARATOR,
  );
  return lines.join("\n");
}

export function formatV1AutoCompleted(stepIds: string[]): string {
  return stepIds.map((id) => `  Auto-completed: '${id}'`).join("\n");
}

export function formatV1Rejection(
  state: V1InstanceState,
  step: V1AgenticStep,
  schemaName: string,
  errors: string[],
  resolvedContext: Record<string, unknown> = {},
): string {
  const interpScope = { ...state.input, ...resolvedContext };
  const resolvedInstruction = interpolate(step.instruction.trim(), interpScope);
  return [
    SEPARATOR,
    "SUBMISSION REJECTED",
    "",
    `Schema: ${schemaName}`,
    "Errors:",
    ...errors.map((e) => `  - ${e}`),
    "",
    `>>> RETRY: ${resolvedInstruction}`,
    `    lrail ${aliasOrId(state)} next --result '<json>'`,
    "",
    "!!! Adjust your output to match the schema and resubmit.",
    SEPARATOR,
  ].join("\n");
}

export function formatV1Completion(state: V1InstanceState): string {
  return [
    SEPARATOR,
    `Workflow '${state.workflow_name}' completed.`,
    "",
    "ALL STEPS DONE. STOP HERE — do not run any more commands.",
    SEPARATOR,
  ].join("\n");
}

export function formatV1Status(def: WorkflowV1Def, state: V1InstanceState): string {
  const lines: string[] = [
    `Workflow: ${state.workflow_name} (${aliasOrId(state)})`,
    `Format:   v1`,
    `Status:   ${state.status}`,
  ];
  if (state.parent) {
    lines.push(`Parent:   ${state.parent.instance_id} (depth ${state.parent.depth})`);
  }
  if (state.active_call) {
    lines.push(`Active call → ${state.active_call.child_workflow_name} (${state.active_call.child.id})`);
  }
  lines.push("", "Steps:");

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const ss = state.steps[step.id];
    const marker =
      ss?.status === "completed" ? "[x]" : ss?.status === "in_progress" ? "[>]" : "[ ]";
    const iter = ss?.iterations && ss.iterations > 1 ? ` ×${ss.iterations}` : "";
    lines.push(
      `  ${marker} ${i + 1}. ${step.id} (${step.type}) — ${ss?.status ?? "missing"}${iter}`,
    );
  }

  if (Object.keys(state.input).length > 0) {
    lines.push("", "Input:");
    for (const [key, val] of Object.entries(state.input)) {
      const display = typeof val === "object" ? JSON.stringify(val) : String(val);
      lines.push(`  ${key}: ${display}`);
    }
  }

  return lines.join("\n");
}

// ── Internal helpers ──

function describeSchemaFields(def: WorkflowV1Def, schemaName: string): string {
  const schema = def.schemas[schemaName];
  if (!schema || typeof schema !== "object") return "";
  if (schema.type !== "object" || !schema.properties) return "";
  const required = new Set(schema.required ?? []);
  return Object.keys(schema.properties)
    .map((k) => `${k}${required.has(k) ? "*" : ""}`)
    .join(", ");
}

function buildExampleResult(def: WorkflowV1Def, schemaName: string): string {
  const schema = def.schemas[schemaName];
  if (!schema || typeof schema !== "object" || schema.type !== "object" || !schema.properties) {
    return "{}";
  }
  const obj: Record<string, string> = {};
  for (const k of Object.keys(schema.properties)) {
    obj[k] = "...";
  }
  return JSON.stringify(obj);
}
