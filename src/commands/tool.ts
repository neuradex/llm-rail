import { appendLog } from "../audit/logger.js";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { saveV1Instance } from "../engine/state-v1.js";
import { executeV1Actions } from "../engine/actions-v1.js";
import type { V1ActionDef } from "../types-v1.js";

export function runTool(instanceId: string, toolName: string, toolArgs: string): void {
  const { state } = loadInstanceAny(instanceId);
  const def = loadWorkflowV1(state.workflow_name);

  if (!def.tools || !def.tools[toolName]) {
    const available = def.tools ? Object.keys(def.tools).join(", ") : "(none)";
    console.error(`Tool "${toolName}" not found. Available: ${available}`);
    process.exit(1);
  }

  const toolDef = def.tools[toolName];

  let parsedArgs: Record<string, unknown> = {};
  if (toolArgs) {
    try {
      parsedArgs = JSON.parse(toolArgs);
    } catch {
      console.error(`Invalid JSON args: ${toolArgs}`);
      process.exit(1);
    }
  }

  if (toolDef.params) {
    for (const [name, param] of Object.entries(toolDef.params)) {
      if (param.required && !(name in parsedArgs)) {
        console.error(`Missing required param: ${name}`);
        process.exit(1);
      }
    }
  }

  // v1 context for tool: workflow input + step outputs (read-only) + tool args.
  const stepOutputs: Record<string, Record<string, unknown>> = {};
  for (const [id, ss] of Object.entries(state.steps)) {
    if (ss.output) stepOutputs[id] = ss.output;
  }
  const context: Record<string, unknown> = {
    ...state.input,
    ...stepOutputs,
    ...parsedArgs,
  };

  // Coerce legacy ActionDef into V1ActionDef shape: tool blocks may not
  // declare name/description (legacy ToolDef.actions used the legacy
  // ActionDef type), so the runtime synthesizes placeholders.
  const actions: V1ActionDef[] = (toolDef.actions || []).map((a, i) => {
    const raw = a as unknown as Record<string, unknown>;
    return {
      name: typeof raw.name === "string" && raw.name.trim() ? (raw.name as string) : `tool-action-${i + 1}`,
      description: typeof raw.description === "string" && raw.description.trim()
        ? (raw.description as string)
        : `Action ${i + 1} of tool '${toolName}'`,
      js: typeof raw.js === "string" ? (raw.js as string) : undefined,
      shell: typeof raw.shell === "string" ? (raw.shell as string) : undefined,
      extract: raw.extract as Record<string, string> | undefined,
    };
  });

  try {
    const result = executeV1Actions(actions, context, 30_000);
    const toolOutput = result.extracted;

    // Persist tool result on a sentinel pseudo-step so context_in
    // references like `{_tools.<name>.field}` keep working.
    const toolBucket = state.steps["_tools"] ?? { status: "completed" as const, output: {} };
    const merged = {
      ...((toolBucket.output as Record<string, unknown>) || {}),
      [toolName]: toolOutput,
    };
    state.steps["_tools"] = {
      status: "completed",
      output: merged,
    };

    saveV1Instance(state);
    appendLog(state.workflow_name, state.id, "tool_called", undefined, {
      tool: toolName,
      args: parsedArgs,
      output: toolOutput,
    });

    console.log(JSON.stringify(toolOutput, null, 2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(state.workflow_name, state.id, "tool_failed", undefined, {
      tool: toolName,
      error: message,
    });
    console.error(`Tool '${toolName}' failed: ${message}`);
    process.exit(1);
  }
}
