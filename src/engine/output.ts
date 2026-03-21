import type { StepDef, WorkflowDef, InstanceState } from "../types.js";
import { pickTips } from "./tip-pool.js";
import { resolveDescription, resolveInstruction, buildStepContext, collectStepOutputs } from "./context.js";

const SEPARATOR = "────────────────────────────────────────";

export function formatStepStart(
  def: WorkflowDef,
  state: InstanceState,
  stepIndex: number,
): string {
  const step = def.steps[stepIndex];
  const total = def.steps.length;
  const stepNum = stepIndex + 1;
  const tips = pickTips(step.tips, 2);
  const fields = (step.required_output || []).join(", ");
  const exampleResult = buildExampleResult(step);

  const params = state.params || {};
  const stepOutputs = collectStepOutputs(state.steps);
  const headerLabel = resolveDescription(step.description || step.id, params, stepOutputs);
  const instruction = resolveInstruction(step.instruction || step.description || step.id, params, stepOutputs);

  const lines: string[] = [
    SEPARATOR,
    `Step ${stepNum}/${total}: ${headerLabel}`,
    "",
    `Required output fields: ${fields}`,
  ];

  // Show resolved context if context_in is present
  if (step.context_in) {
    const ctx = buildStepContext(step, params, stepOutputs);
    if (Object.keys(ctx).length > 0) {
      lines.push("");
      lines.push("Context:");
      for (const [key, val] of Object.entries(ctx)) {
        const display = typeof val === "object" ? JSON.stringify(val) : String(val);
        lines.push(`  ${key}: ${display}`);
      }
    }
  }

  // Show pool status for accumulate steps
  if (step.accumulate) {
    const pool = state.steps[step.id]?.output;
    if (pool) {
      lines.push("");
      lines.push("Pool (accumulated so far):");
      for (const [field, config] of Object.entries(step.accumulate)) {
        const arr = Array.isArray(pool[field]) ? pool[field] as unknown[] : [];
        lines.push(`  ${field}: ${arr.length} items (dedupe key: ${config.key})`);
      }
    }
    lines.push("");
    lines.push("MODE: accumulate — submit a batch, it will be merged into the pool. Repeat until validation passes.");
  }

  lines.push(
    "",
    `>>> NEXT ACTION: ${instruction}`,
    `    lrail ${state.alias || state.id} next --result '${exampleResult}'`,
    "",
    "!!! WARNING: Submit ALL required fields or submission will be rejected.",
  );

  for (const tip of tips) {
    lines.push(`\nTIP: ${tip}`);
  }

  lines.push(SEPARATOR);
  return lines.join("\n");
}

export function formatAutoCompleted(stepIds: string[]): string {
  const lines = stepIds.map((id) => `  Auto-completed: '${id}'`);
  return lines.join("\n");
}

export function formatRejection(
  state: InstanceState,
  step: StepDef,
  errors: string[],
): string {
  const fields = (step.required_output || []).join(", ");
  const exampleResult = buildExampleResult(step);

  const isAccumulate = !!step.accumulate;
  const header = isAccumulate ? "NOT YET COMPLETE — keep submitting batches" : "SUBMISSION REJECTED";
  const action = isAccumulate ? "CONTINUE" : "RETRY";

  const lines: string[] = [
    SEPARATOR,
    header,
    "",
    "Errors:",
    ...errors.map((e) => `  - ${e}`),
    "",
    `Required output fields: ${fields}`,
    "",
    `>>> ${action}: ${step.instruction || step.description}`,
    `    lrail ${state.alias || state.id} next --result '${exampleResult}'`,
    "",
    isAccumulate
      ? "Submit your next batch. It will be merged into the pool with deduplication."
      : "!!! WARNING: Submit ALL required fields or submission will be rejected.",
    SEPARATOR,
  ];
  return lines.join("\n");
}

export function formatCompletion(state: InstanceState): string {
  return [
    SEPARATOR,
    `Workflow '${state.workflow_name}' completed.`,
    "",
    "ALL STEPS DONE. STOP HERE — do not run any more commands.",
    SEPARATOR,
  ].join("\n");
}

export function formatStatus(def: WorkflowDef, state: InstanceState): string {
  const lines: string[] = [
    `Workflow: ${state.workflow_name} (${state.alias || state.id})`,
  ];
  if (state.variant) lines.push(`Variant: ${state.variant}`);
  lines.push(`Status: ${state.status}`, "", "Steps:");

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const ss = state.steps[step.id];
    const marker =
      ss.status === "completed" ? "[x]" : ss.status === "in_progress" ? "[>]" : "[ ]";
    lines.push(`  ${marker} ${i + 1}. ${step.id} - ${step.description || step.id} (${ss.status})`);
  }

  if (state.params && Object.keys(state.params).length > 0) {
    lines.push("");
    lines.push("Params:");
    for (const [key, val] of Object.entries(state.params)) {
      lines.push(`  ${key}: ${String(val)}`);
    }
  }

  return lines.join("\n");
}

function buildExampleResult(step: StepDef): string {
  const obj: Record<string, string> = {};
  for (const field of step.required_output || []) {
    obj[field] = "...";
  }
  return JSON.stringify(obj);
}
