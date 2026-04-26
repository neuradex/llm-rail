import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import {
  isAgenticStep,
  isProgrammaticStep,
  isRouterStep,
  isCallStep,
} from "../types-v1.js";
import { buildStepContextV1 } from "../engine/context-v1.js";
import type { V1InstanceState } from "../engine/state-v1.js";

export function runQuery(id: string, stepId?: string): void {
  const { state } = loadInstanceAny(id);
  const def = loadWorkflowV1(state.workflow_name);

  const targetId = stepId ?? state.current_step_id;
  if (!targetId) {
    console.log(JSON.stringify({
      instance_id: state.id,
      workflow: state.workflow_name,
      format: "v1",
      status: state.status,
      message: "Workflow has no current step.",
    }, null, 2));
    return;
  }

  const stepIndex = def.steps.findIndex((s) => s.id === targetId);
  if (stepIndex === -1) {
    console.error(`Step '${targetId}' not found in workflow.`);
    process.exit(1);
  }
  const step = def.steps[stepIndex];
  const stepState = state.steps[step.id];

  let context: Record<string, unknown> = {};
  if (isAgenticStep(step) || isProgrammaticStep(step) || isRouterStep(step)) {
    try {
      context = buildStepContextV1(step.id, step.context_in, state);
    } catch {
      // Some refs may not be ready yet; that's fine for query.
    }
  }

  const queryResult: Record<string, unknown> = {
    instance_id: state.id,
    workflow: state.workflow_name,
    format: "v1",
    input: state.input,
    step: {
      id: step.id,
      index: stepIndex + 1,
      total: def.steps.length,
      type: step.type,
      ...(step.description && { description: step.description }),
      ...(isAgenticStep(step) && { instruction: step.instruction }),
      status: stepState?.status ?? "missing",
      ...(stepState?.iterations && { iterations: stepState.iterations }),
    },
    context,
  };

  if (isAgenticStep(step) || isProgrammaticStep(step)) {
    if (step.required_output) {
      (queryResult.step as Record<string, unknown>).required_output_schema = step.required_output;
      const schema = def.schemas[step.required_output];
      if (schema?.properties) {
        const fields = Object.keys(schema.properties);
        const example: Record<string, string> = {};
        for (const f of fields) example[f] = "...";
        queryResult.expected_output_fields = fields;
        if (isAgenticStep(step)) {
          queryResult.submit_command = `lrail ${state.alias || state.id} next --result '${JSON.stringify(example)}'`;
        }
      }
    }
  } else if (isRouterStep(step)) {
    (queryResult.step as Record<string, unknown>).cases = step.cases.map((c) => ({
      goto: c.goto,
      when_summary: JSON.stringify(c.when),
    }));
    (queryResult.step as Record<string, unknown>).default_goto = step.default;
  } else if (isCallStep(step)) {
    (queryResult.step as Record<string, unknown>).workflow = step.workflow;
    (queryResult.step as Record<string, unknown>).inputs = step.inputs;
  }

  console.log(JSON.stringify(queryResult, null, 2));
}
