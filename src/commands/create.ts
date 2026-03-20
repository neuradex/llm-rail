import { loadWorkflow, validateWorkflowDef } from "../engine/workflow.js";
import { createInstance } from "../engine/state.js";
import { appendLog } from "../audit/logger.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";
import type { ParamDef } from "../types.js";

export function runCreate(workflowName: string, rawParams?: string[]): void {
  const def = loadWorkflow(workflowName);

  const errors = validateWorkflowDef(def);
  if (errors.length > 0) {
    console.error("Workflow definition errors:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // Parse and validate params
  const params = parseParams(rawParams || [], def.params);

  const state = createInstance(def, params);
  appendLog(def.name, state.id, "created", undefined, { workflow_name: def.name, params });

  // Fire hook
  fireHook(makeHookPayload("workflow:created", state.id, def.name));

  // Output
  const lines: string[] = [`Instance created: ${state.id}`];
  lines.push(`Workflow: ${def.name}`);
  if (Object.keys(params).length > 0) {
    const paramStr = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`Params: ${paramStr}`);
  }
  const stepIds = def.steps.map((s) => s.id).join(" → ");
  lines.push(`Steps: ${stepIds}`);

  console.log(lines.join("\n"));
}

function parseParams(
  rawParams: string[],
  paramDefs?: Record<string, ParamDef>,
): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};

  for (const raw of rawParams) {
    const eqIdx = raw.indexOf("=");
    if (eqIdx === -1) {
      console.error(`Invalid param format: '${raw}' (expected key=value)`);
      process.exit(1);
    }
    const key = raw.slice(0, eqIdx);
    const val = raw.slice(eqIdx + 1);
    parsed[key] = val;
  }

  if (!paramDefs) return parsed;

  // Apply defaults and type coercion
  for (const [name, def] of Object.entries(paramDefs)) {
    if (!(name in parsed)) {
      if (def.default !== undefined) {
        parsed[name] = def.default;
      } else if (def.required) {
        console.error(`Missing required param: '${name}'`);
        process.exit(1);
      }
      continue;
    }

    // Type coercion
    const raw = String(parsed[name]);
    switch (def.type) {
      case "number": {
        const num = Number(raw);
        if (isNaN(num)) {
          console.error(`Param '${name}' must be a number (got '${raw}')`);
          process.exit(1);
        }
        parsed[name] = num;
        break;
      }
      case "boolean":
        parsed[name] = raw === "true" || raw === "1";
        break;
      case "string":
      default:
        parsed[name] = raw;
        break;
    }
  }

  return parsed;
}
