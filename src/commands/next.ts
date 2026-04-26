import { saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { validateStepOutput, runAssertions } from "../engine/validator.js";
import { formatStepStart, formatRejection, formatCompletion, formatAutoCompleted } from "../engine/output.js";
import { appendLog } from "../audit/logger.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";
import { collectStepOutputs, resolveTemplate } from "../engine/context.js";
import { executeActions } from "../engine/actions.js";
import { advanceThrough } from "../engine/runner.js";
import { nowISO } from "../util.js";
import type { WorkflowDef, InstanceState, AccumulateFieldConfig, StepDef, AssertionRule } from "../types.js";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { saveV1Instance, type V1InstanceState } from "../engine/state-v1.js";
import { submitAgenticResult, V1OutputValidationError } from "../engine/runner-v1.js";
import { makeFilesystemV1Registry } from "../engine/registry-v1.js";
import {
  formatV1AgenticStart,
  formatV1AutoCompleted,
  formatV1Completion,
  formatV1Rejection,
} from "../engine/output-v1.js";
import { buildStepContextV1 } from "../engine/context-v1.js";
import { isAgenticStep, type WorkflowV1Def } from "../types-v1.js";

export function runNext(id: string, resultJson: string): void {
  const loaded = loadInstanceAny(id);
  if (loaded.kind === "v1") {
    runNextV1(id, loaded.state, resultJson);
    return;
  }

  // ── Legacy path ──
  const state = loaded.state;

  if (state.status !== "in_progress") {
    console.error(`Workflow is not in progress (status: ${state.status}). Run 'lrail ${id} start' first.`);
    process.exit(1);
  }

  const def = loadWorkflow(state.workflow_name, state.variant);
  const currentStep = def.steps[state.current_step];

  if (!currentStep) {
    console.error("No current step found.");
    process.exit(1);
  }

  // Parse result
  let output: Record<string, unknown>;
  try {
    output = JSON.parse(resultJson);
  } catch {
    console.error("Invalid JSON in --result");
    process.exit(1);
  }

  // Accumulate mode: merge new output into existing pool
  if (currentStep.accumulate) {
    const existing = state.steps[currentStep.id].output || {};
    output = mergeAccumulate(existing, output, currentStep.accumulate);
  }

  // Resolve template variables in validation rules before checking
  const stepOutputs = collectStepOutputs(state.steps, state.context);
  const resolvedStep = resolveStepRules(currentStep, state.params || {}, stepOutputs);

  // Validate step output (validation rules)
  const result = validateStepOutput(resolvedStep, output);

  if (!result.valid) {
    // In accumulate mode: save progress, show pool status, and stay in step
    if (currentStep.accumulate) {
      state.steps[currentStep.id].output = output;
      saveInstance(state);
      const poolStatus = formatPoolStatus(output, currentStep.accumulate);
      appendLog(state.workflow_name, state.id, "pool_updated", currentStep.id, { errors: result.errors, pool: poolStatus });
      console.log(formatRejection(state, currentStep, result.errors));
      console.log(`\nPool status: ${poolStatus}`);
      process.exit(1);
    }
    appendLog(state.workflow_name, state.id, "step_rejected", currentStep.id, { errors: result.errors });
    fireHook(
      makeHookPayload("step:rejected", state.id, state.workflow_name, currentStep.id, {
        errors: result.errors,
      }),
    );
    console.log(formatRejection(state, currentStep, result.errors));
    process.exit(1);
  }

  // Gate hook: step:before_complete
  const hookResult = fireHook(
    makeHookPayload(
      "step:before_complete",
      state.id,
      state.workflow_name,
      currentStep.id,
      { output },
      currentStep.meta,
    ),
  );
  if (!hookResult.allow) {
    console.error(
      `Step '${currentStep.id}' completion blocked by hook: ${hookResult.message || "no reason given"}`,
    );
    process.exit(1);
  }

  // Execute post-validation actions if defined on agentic step
  if (currentStep.actions && currentStep.actions.length > 0) {
    try {
      const actionResult = executeActions(currentStep.actions, { ...state.context, ...output }, currentStep.timeout_ms);
      Object.assign(output, actionResult.extracted);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Action failed in step '${currentStep.id}': ${message}`);
      process.exit(1);
    }
  }

  // Complete current step
  state.steps[currentStep.id].status = "completed";
  state.steps[currentStep.id].output = output;
  state.steps[currentStep.id].completed_at = nowISO();

  // Merge output into context
  Object.assign(state.context, output);

  appendLog(state.workflow_name, state.id, "step_completed", currentStep.id, { output });

  // Event hook: step:completed
  fireHook(
    makeHookPayload("step:completed", state.id, state.workflow_name, currentStep.id, { output }, currentStep.meta),
  );

  // Run cross-step assertions if defined
  if (resolvedStep.assertions) {
    const mergedData: Record<string, unknown> = { ...state.context };
    const assertResult = runAssertions(resolvedStep.assertions, mergedData);

    // Log script assertion results to audit log
    if (assertResult.script_logs) {
      appendLog(state.workflow_name, state.id, "script_assertion", currentStep.id, {
        logs: assertResult.script_logs,
      });
    }

    if (!assertResult.valid) {
      appendLog(state.workflow_name, state.id, "assertion_failed", currentStep.id, { errors: assertResult.errors });
      // Revert step completion
      state.steps[currentStep.id].status = "in_progress";
      state.steps[currentStep.id].output = undefined;
      state.steps[currentStep.id].completed_at = undefined;
      // Remove output from context
      for (const key of Object.keys(output)) {
        delete state.context[key];
      }
      saveInstance(state);
      console.log(formatRejection(state, currentStep, assertResult.errors));
      process.exit(1);
    }
  }

  // Advance through programmatic steps
  try {
    const { reachedStep, autoCompleted } = advanceThrough(def, state);

    if (autoCompleted.length > 0) {
      console.log(formatAutoCompleted(autoCompleted));
    }

    if (reachedStep === -1) {
      // Workflow complete
      state.status = "completed";
      saveInstance(state);
      appendLog(state.workflow_name, state.id, "workflow_completed");
      fireHook(makeHookPayload("workflow:completed", state.id, state.workflow_name));
      console.log(formatCompletion(state));
      return;
    }

    // Start next agentic step
    const nextStep = def.steps[reachedStep];
    state.steps[nextStep.id].status = "in_progress";
    state.current_step = reachedStep;
    saveInstance(state);

    appendLog(state.workflow_name, state.id, "step_started", nextStep.id);
    fireHook(
      makeHookPayload("step:started", state.id, state.workflow_name, nextStep.id, undefined, nextStep.meta),
    );

    console.log(formatStepStart(def, state, reachedStep));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

function mergeAccumulate(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  config: Record<string, AccumulateFieldConfig>,
): Record<string, unknown> {
  const merged = { ...existing };

  for (const [field, fieldConfig] of Object.entries(config)) {
    const existingArr = Array.isArray(merged[field]) ? (merged[field] as Record<string, unknown>[]) : [];
    const incomingArr = Array.isArray(incoming[field]) ? (incoming[field] as Record<string, unknown>[]) : [];

    // Build set of existing keys for dedup
    const seen = new Set<unknown>();
    for (const item of existingArr) {
      seen.add(item[fieldConfig.key]);
    }

    // Append only new items
    const deduped = [...existingArr];
    for (const item of incomingArr) {
      const keyVal = item[fieldConfig.key];
      if (!seen.has(keyVal)) {
        seen.add(keyVal);
        deduped.push(item);
      }
    }

    merged[field] = deduped;
  }

  // Overwrite non-accumulate fields
  for (const [field, value] of Object.entries(incoming)) {
    if (!(field in config)) {
      merged[field] = value;
    }
  }

  return merged;
}

/**
 * Resolve template variables ({{param}}, {step.field}) in validation/assertion rule values and messages.
 */
function resolveStepRules(
  step: StepDef,
  params: Record<string, unknown>,
  stepOutputs: Record<string, Record<string, unknown>>,
): StepDef {
  const resolveRules = (rules: AssertionRule[]): AssertionRule[] =>
    rules.map((rule) => {
      const resolved = { ...rule };
      if (typeof resolved.value === "string") {
        const str = resolveTemplate(resolved.value, params, stepOutputs);
        // Convert to number if the resolved string is numeric
        const num = Number(str);
        resolved.value = isNaN(num) ? str : num;
      }
      if (typeof resolved.message === "string") {
        resolved.message = resolveTemplate(resolved.message, params, stepOutputs);
      }
      return resolved;
    });

  const copy = { ...step };
  if (copy.validation) copy.validation = resolveRules(copy.validation);
  if (copy.assertions) copy.assertions = resolveRules(copy.assertions);
  return copy;
}

function formatPoolStatus(
  output: Record<string, unknown>,
  config: Record<string, AccumulateFieldConfig>,
): string {
  const parts: string[] = [];
  for (const field of Object.keys(config)) {
    const arr = Array.isArray(output[field]) ? output[field] : [];
    parts.push(`${field}: ${(arr as unknown[]).length} items`);
  }
  return parts.join(", ");
}

// ── v1 ──

function runNextV1(idOrAlias: string, state: V1InstanceState, resultJson: string): void {
  if (state.status !== "in_progress") {
    console.error(
      `Workflow is not in progress (status: ${state.status}). Run 'lrail ${idOrAlias} start' first.`,
    );
    process.exit(1);
  }

  let output: Record<string, unknown>;
  try {
    output = JSON.parse(resultJson);
  } catch {
    console.error("Invalid JSON in --result");
    process.exit(1);
  }

  const def = loadWorkflowV1(state.workflow_name);
  const registry = makeFilesystemV1Registry();

  // Submit. The runner descends into any active call automatically and
  // routes the output to the deepest awaiting agentic step.
  let result;
  try {
    result = submitAgenticResult(def, state, output, registry);
  } catch (err) {
    if (err instanceof V1OutputValidationError) {
      saveV1Instance(state);
      const pendingStep = currentAgenticStep(def, state);
      appendLog(state.workflow_name, state.id, "step_rejected", err.stepId, {
        errors: err.validationErrors,
      });
      if (pendingStep) {
        console.log(
          formatV1Rejection(state, pendingStep, err.schemaName, err.validationErrors),
        );
      } else {
        console.log(`Submission rejected:\n${err.validationErrors.map((e) => `  - ${e}`).join("\n")}`);
      }
      process.exit(1);
    }
    saveV1Instance(state);
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  if (result.autoCompleted.length > 0) {
    console.log(formatV1AutoCompleted(result.autoCompleted));
    for (const stepId of result.autoCompleted) {
      appendLog(state.workflow_name, state.id, "step_auto_completed", stepId);
    }
  }

  if (result.kind === "completed") {
    saveV1Instance(state);
    appendLog(state.workflow_name, state.id, "workflow_completed");
    console.log(formatV1Completion(state));
    return;
  }

  if (result.kind === "error") {
    saveV1Instance(state);
    appendLog(state.workflow_name, state.id, "workflow_error", undefined, {
      message: result.error?.message,
    });
    console.error(`Workflow error: ${result.error?.message}`);
    process.exit(1);
  }

  // awaiting_agent — pause at next agentic
  saveV1Instance(state);
  const pending = result.pendingStep!;
  appendLog(state.workflow_name, state.id, "step_started", pending.id);
  if (isAgenticStep(pending)) {
    const ctx = buildPendingContextV1(def, state, pending.id);
    console.log(formatV1AgenticStart(def, state, pending, ctx));
  } else {
    console.log(`Awaiting input on step '${pending.id}'.`);
  }
}

/**
 * Find the step currently awaiting agent input. With nested calls this
 * may live inside an active_call's child instance.
 */
function currentAgenticStep(def: WorkflowV1Def, state: V1InstanceState) {
  if (state.active_call) {
    const childDef = makeFilesystemV1Registry().load(state.active_call.child_workflow_name);
    if (childDef) {
      return currentAgenticStep(childDef, state.active_call.child);
    }
  }
  const stepId = state.current_step_id;
  if (!stepId) return undefined;
  const step = def.steps.find((s) => s.id === stepId);
  return step && isAgenticStep(step) ? step : undefined;
}

function buildPendingContextV1(
  def: WorkflowV1Def,
  state: V1InstanceState,
  stepId: string,
): Record<string, unknown> {
  if (state.active_call) {
    const childDef = makeFilesystemV1Registry().load(state.active_call.child_workflow_name);
    if (childDef) {
      return buildPendingContextV1(childDef, state.active_call.child, stepId);
    }
  }
  const step = def.steps.find((s) => s.id === stepId);
  if (!step || !isAgenticStep(step)) return {};
  try {
    return buildStepContextV1(stepId, step.context_in, state);
  } catch {
    return {};
  }
}
