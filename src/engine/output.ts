import type { StepDef, WorkflowDef, InstanceState } from "../types.js";
import { pickTips } from "./tip-pool.js";
import { resolveDescription, buildStepContext, collectStepOutputs } from "./context.js";

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
  const description = resolveDescription(step.description || step.id, params, stepOutputs);

  const lines: string[] = [
    SEPARATOR,
    `Step ${stepNum}/${total}: ${description}`,
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

  lines.push(
    "",
    `>>> NEXT ACTION: ${description}`,
    `    llm-rail ${state.id} next --result '${exampleResult}'`,
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

  const lines: string[] = [
    SEPARATOR,
    "SUBMISSION REJECTED",
    "",
    "Errors:",
    ...errors.map((e) => `  - ${e}`),
    "",
    `Required output fields: ${fields}`,
    "",
    `>>> RETRY: ${step.description}`,
    `    llm-rail ${state.id} next --result '${exampleResult}'`,
    "",
    "!!! WARNING: Submit ALL required fields or submission will be rejected.",
    SEPARATOR,
  ];
  return lines.join("\n");
}

export function formatCompletion(state: InstanceState): string {
  return [
    SEPARATOR,
    `Workflow '${state.workflow_name}' completed.`,
    "",
    "Task complete. Report to parent agent.",
    SEPARATOR,
  ].join("\n");
}

export function formatStatus(def: WorkflowDef, state: InstanceState): string {
  const lines: string[] = [
    `Workflow: ${state.workflow_name} (${state.id})`,
    `Status: ${state.status}`,
    "",
    "Steps:",
  ];

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
