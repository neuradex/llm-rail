import type { StepDef } from "../types.js";

/**
 * Resolve a template string by substituting:
 * - {{paramName}} → workflow parameter
 * - {stepId.field} → completed step output field
 */
export function resolveTemplate(
  template: string,
  params: Record<string, unknown>,
  stepOutputs: Record<string, Record<string, unknown>>,
): string {
  // {{paramName}}
  let result = template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const val = params[name];
    return val !== undefined ? String(val) : `{{${name}}}`;
  });

  // {stepId.field}
  result = result.replace(/\{([\w-]+)\.([\w-]+)\}/g, (_match, stepId: string, field: string) => {
    const output = stepOutputs[stepId];
    if (!output) return `{${stepId}.${field}}`;
    const val = output[field];
    if (val === undefined) return `{${stepId}.${field}}`;
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });

  return result;
}

/**
 * Build context for a step by resolving context_in mappings.
 */
export function buildStepContext(
  stepDef: StepDef,
  params: Record<string, unknown>,
  stepOutputs: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  if (!stepDef.context_in) return {};

  const ctx: Record<string, unknown> = {};
  for (const [key, tmpl] of Object.entries(stepDef.context_in)) {
    // Try direct resolution for {stepId.field} → actual value (not stringified)
    const directMatch = tmpl.match(/^\{([\w-]+)\.([\w-]+)\}$/);
    if (directMatch) {
      const [, stepId, field] = directMatch;
      const output = stepOutputs[stepId];
      if (output && field in output) {
        ctx[key] = output[field];
        continue;
      }
    }

    // Try direct resolution for {{paramName}} → actual value
    const paramMatch = tmpl.match(/^\{\{(\w+)\}\}$/);
    if (paramMatch) {
      const [, name] = paramMatch;
      if (name in params) {
        ctx[key] = params[name];
        continue;
      }
    }

    // Fallback to string template resolution
    ctx[key] = resolveTemplate(tmpl, params, stepOutputs);
  }

  return ctx;
}

/**
 * Resolve description template for display.
 */
export function resolveDescription(
  description: string,
  params: Record<string, unknown>,
  stepOutputs: Record<string, Record<string, unknown>>,
): string {
  return resolveTemplate(description, params, stepOutputs);
}

/**
 * Resolve instruction template for agent directive.
 */
export function resolveInstruction(
  instruction: string,
  params: Record<string, unknown>,
  stepOutputs: Record<string, Record<string, unknown>>,
): string {
  return resolveTemplate(instruction, params, stepOutputs);
}

/**
 * Collect step outputs keyed by step ID from instance state.
 */
export function collectStepOutputs(
  steps: Record<string, { output?: Record<string, unknown> }>,
): Record<string, Record<string, unknown>> {
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const [id, state] of Object.entries(steps)) {
    if (state.output) {
      outputs[id] = state.output;
    }
  }
  return outputs;
}
