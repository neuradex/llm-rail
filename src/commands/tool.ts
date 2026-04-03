import { loadInstance, saveInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { executeActions } from "../engine/actions.js";
import { collectStepOutputs } from "../engine/context.js";
import { appendLog } from "../audit/logger.js";

export function runTool(instanceId: string, toolName: string, toolArgs: string): void {
  const state = loadInstance(instanceId);
  const def = loadWorkflow(state.workflow_name, state.variant);

  if (!def.tools || !def.tools[toolName]) {
    const available = def.tools ? Object.keys(def.tools).join(", ") : "(none)";
    console.error(`Tool "${toolName}" not found. Available: ${available}`);
    process.exit(1);
  }

  const toolDef = def.tools[toolName];

  // Parse args
  let parsedArgs: Record<string, unknown> = {};
  if (toolArgs) {
    try {
      parsedArgs = JSON.parse(toolArgs);
    } catch {
      console.error(`Invalid JSON args: ${toolArgs}`);
      process.exit(1);
    }
  }

  // Validate required params
  if (toolDef.params) {
    for (const [name, param] of Object.entries(toolDef.params)) {
      if (param.required && !(name in parsedArgs)) {
        console.error(`Missing required param: ${name}`);
        process.exit(1);
      }
    }
  }

  // Build context: workflow params + step outputs + tool args
  const stepOutputs = collectStepOutputs(state.steps, state.context);
  const context: Record<string, unknown> = {
    ...state.params,
    ...stepOutputs,
    ...parsedArgs,
  };

  // Execute tool actions
  try {
    const result = executeActions(toolDef.actions, context);
    console.log(JSON.stringify(result, null, 2));

    // Persist tool call to state for assertion/context access
    const toolCalls = (state.context._tool_calls ?? {}) as Record<string, unknown[]>;
    if (!toolCalls[toolName]) toolCalls[toolName] = [];
    toolCalls[toolName].push({ args: parsedArgs, result, at: new Date().toISOString() });
    state.context._tool_calls = toolCalls;
    saveInstance(state);

    appendLog(state.workflow_name, instanceId, "tool_called", undefined, { tool: toolName, args: parsedArgs, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Tool "${toolName}" failed: ${message}`);
    appendLog(state.workflow_name, instanceId, "tool_failed", undefined, { tool: toolName, args: parsedArgs, error: message });
    process.exit(1);
  }
}
