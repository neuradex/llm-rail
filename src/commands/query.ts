import { loadInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { resolveDescription, buildStepContext, collectStepOutputs } from "../engine/context.js";

export function runQuery(id: string, stepId?: string): void {
  const state = loadInstance(id);
  const def = loadWorkflow(state.workflow_name);

  // Determine which step to query
  let stepIndex: number;
  if (stepId) {
    stepIndex = def.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      console.error(`Step '${stepId}' not found in workflow.`);
      process.exit(1);
    }
  } else {
    // Default to current step
    stepIndex = state.current_step;
  }

  const step = def.steps[stepIndex];
  const stepState = state.steps[step.id];
  const params = state.params || {};
  const stepOutputs = collectStepOutputs(state.steps);

  const description = resolveDescription(step.description, params, stepOutputs);
  const context = buildStepContext(step, params, stepOutputs);

  // Also include params in context if no explicit context_in
  if (!step.context_in && Object.keys(params).length > 0) {
    Object.assign(context, params);
  }

  const exampleResult: Record<string, string> = {};
  for (const field of step.required_output) {
    exampleResult[field] = "...";
  }

  const queryResult = {
    instance_id: state.id,
    workflow: state.workflow_name,
    ...(Object.keys(params).length > 0 && { params }),
    step: {
      id: step.id,
      index: stepIndex + 1,
      total: def.steps.length,
      description,
      status: stepState.status,
    },
    context,
    expected_output: step.required_output,
    ...(step.tips && step.tips.length > 0 && { tips: step.tips }),
    submit_command: `llm-rail ${state.id} next --result '${JSON.stringify(exampleResult)}'`,
  };

  console.log(JSON.stringify(queryResult, null, 2));
}
