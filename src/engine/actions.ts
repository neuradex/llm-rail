import { execFileSync } from "node:child_process";
import type { ActionDef } from "../types.js";

export interface ActionResult {
  stdout: string;
  extracted: Record<string, unknown>;
}

/**
 * Resolve {{field}} templates in an action's run command.
 */
export function resolveActionCommand(run: string, context: Record<string, unknown>): string {
  return run.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (key in context) {
      const val = context[key];
      return typeof val === "object" ? JSON.stringify(val) : String(val);
    }
    return `{{${key}}}`;
  });
}

/**
 * Execute a single action: shell command via sh -c, with context JSON on stdin.
 * Optionally extracts values from stdout JSON using the extract map.
 */
export function executeAction(
  action: ActionDef,
  context: Record<string, unknown>,
): ActionResult {
  const resolved = resolveActionCommand(action.run, context);

  const contextJson = JSON.stringify(context);
  const stdout = execFileSync("sh", ["-c", resolved], {
    input: contextJson,
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CONTEXT: contextJson },
  });

  const extracted: Record<string, unknown> = {};

  if (action.extract) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      // If stdout is not JSON, extract will find nothing
    }

    for (const [targetKey, sourceKey] of Object.entries(action.extract)) {
      if (sourceKey in parsed) {
        extracted[targetKey] = parsed[sourceKey];
      }
    }
  }

  return { stdout: stdout.trim(), extracted };
}

/**
 * Execute actions sequentially. Each action's extracted values are merged
 * into the context for subsequent actions.
 */
export function executeActions(
  actions: ActionDef[],
  context: Record<string, unknown>,
): Record<string, unknown> {
  const accumulated: Record<string, unknown> = {};
  const runningContext = { ...context };

  for (const action of actions) {
    const result = executeAction(action, runningContext);
    Object.assign(accumulated, result.extracted);
    Object.assign(runningContext, result.extracted);
  }

  return accumulated;
}
