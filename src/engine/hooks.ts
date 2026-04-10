import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { HookEvent, HookPayload, HookResult } from "../types.js";
import { getDataDir } from "../util.js";

function hooksDir(): string {
  return path.resolve(getDataDir(), "hooks");
}

const GATE_EVENTS: Set<HookEvent> = new Set([
  "step:before_start",
  "step:before_complete",
]);

/**
 * Find hook scripts matching the event name.
 * Convention: .llm-rail/hooks/<event-name-with-colons-replaced>.*
 * e.g. step:before_start → step-before_start.sh
 */
function findHookScripts(event: HookEvent): string[] {
  const dir = hooksDir();
  if (!fs.existsSync(dir)) return [];

  const prefix = event.replace(/:/g, "-");
  const files = fs.readdirSync(dir);
  return files
    .filter((f) => {
      const base = path.parse(f).name;
      return base === prefix;
    })
    .map((f) => path.resolve(dir, f));
}

function executeHookScript(scriptPath: string, payload: HookPayload): HookResult {
  try {
    const result = execFileSync(scriptPath, {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      return JSON.parse(result.trim()) as HookResult;
    } catch {
      // If output isn't valid JSON, treat as allow
      return { allow: true };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { allow: false, message: `Hook script error: ${message}` };
  }
}

/**
 * Fire a hook event. For gate events (before_*), returns the aggregated result.
 * For non-gate events, fires and forgets.
 */
export function fireHook(payload: HookPayload): HookResult {
  const scripts = findHookScripts(payload.event);
  if (scripts.length === 0) return { allow: true };

  const isGate = GATE_EVENTS.has(payload.event);

  for (const script of scripts) {
    const result = executeHookScript(script, payload);
    if (isGate && !result.allow) {
      return result;
    }
  }

  return { allow: true };
}

/**
 * Create a HookPayload helper.
 */
export function makeHookPayload(
  event: HookEvent,
  instanceId: string,
  workflowName: string,
  stepId?: string,
  data?: Record<string, unknown>,
  meta?: Record<string, unknown>,
): HookPayload {
  return {
    event,
    instance_id: instanceId,
    workflow_name: workflowName,
    ...(stepId && { step_id: stepId }),
    ...(data && { data }),
    ...(meta && { meta }),
  };
}
