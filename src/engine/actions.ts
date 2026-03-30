import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ActionDef, JsActionDef, ShellActionDef } from "../types.js";
import { loadLrailConfig } from "./gateway.js";
import { buildSanitizedEnv, resolveAllSecrets, redactSecrets, mergeEnvPolicies } from "./secrets.js";

// ── Type guards ──

function isJsAction(a: ActionDef): a is JsActionDef { return "js" in a; }
function isShellAction(a: ActionDef): a is ShellActionDef { return "shell" in a; }

// ── Result types ──

export interface ActionResult {
  stdout: string;
  extracted: Record<string, unknown>;
}

/** Data piped from one action to the next */
interface PipeInput {
  stdout?: string;
}

// ── Helpers ──

function tmpFile(prefix: string, ext: string): string {
  return path.join(os.tmpdir(), `lrail-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

function cleanupFile(p?: string): void {
  if (p && fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

/**
 * Resolve {{field}} templates in a shell command.
 */
export function resolveActionCommand(cmd: string, context: Record<string, unknown>): string {
  return cmd.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (key in context) {
      const val = context[key];
      return typeof val === "object" ? JSON.stringify(val) : String(val);
    }
    return `{{${key}}}`;
  });
}

// ── JS action ──

/**
 * Execute a `js:` action.
 *
 * The user's code receives `context` as a variable and uses `return` to
 * produce output. The framework handles serialization on both ends.
 *
 * Context is always passed via a temp file — no env var size limits.
 */
function executeJsAction(
  action: JsActionDef,
  context: Record<string, unknown>,
  pipe?: PipeInput,
): ActionResult {
  const ctx = { ...context };
  if (pipe?.stdout !== undefined) {
    ctx.stdout = pipe.stdout;
  }

  const ctxFile = tmpFile("ctx", ".json");
  const scriptFile = tmpFile("js", ".mjs");

  try {
    fs.writeFileSync(ctxFile, JSON.stringify(ctx), "utf-8");

    const wrapper = `
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";
const context = JSON.parse(readFileSync(${JSON.stringify(ctxFile)}, "utf8"));
const __result = await (async () => {
${action.js}
})();
if (__result !== undefined && __result !== null) {
  process.stdout.write(JSON.stringify(__result));
}
`;
    fs.writeFileSync(scriptFile, wrapper, "utf-8");

    const stdout = execFileSync("node", [scriptFile], {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const extracted: Record<string, unknown> = {};
    const trimmed = stdout.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          Object.assign(extracted, parsed);
        }
      } catch {
        // Non-JSON return — ignore
      }
    }

    return { stdout: trimmed, extracted };
  } catch (e: unknown) {
    const err = e as { stderr?: string; status?: number };
    const stderr = err.stderr?.trim() || "";
    const meaningful = stderr.split("\n").find(l => !l.startsWith("    at ") && l.trim() !== "") || stderr;
    throw new Error(`js action failed: ${meaningful}`);
  } finally {
    cleanupFile(ctxFile);
    cleanupFile(scriptFile);
  }
}

// ── Shell action ──

/**
 * Execute a `shell:` action.
 *
 * Supports {{field}} template resolution.
 * When piped from a previous action, the previous stdout is passed as stdin.
 */
function executeShellAction(
  action: ShellActionDef,
  context: Record<string, unknown>,
  pipe?: PipeInput,
): ActionResult {
  const resolved = resolveActionCommand(action.shell, context);

  const contextJson = JSON.stringify(context);
  let ctxFile: string | undefined;

  // Env mediation: use sanitized env with secrets injected when active
  const config = loadLrailConfig();
  const envPolicy = config?.env ? mergeEnvPolicies(config.env) : undefined;
  const secretValues = envPolicy ? resolveAllSecrets(envPolicy) : new Map<string, string>();
  const baseEnv = envPolicy
    ? buildSanitizedEnv(envPolicy, secretValues)
    : { ...process.env } as Record<string, string>;
  const env: Record<string, string> = { ...baseEnv };

  if (contextJson.length <= 8192) {
    env.CONTEXT = contextJson;
  } else {
    ctxFile = tmpFile("ctx", ".json");
    fs.writeFileSync(ctxFile, contextJson, "utf-8");
    env.CONTEXT_FILE = ctxFile;
  }

  try {
    const stdinData = pipe?.stdout ?? (ctxFile ? undefined : contextJson);
    const stdout = execFileSync("sh", ["-c", resolved], {
      ...(stdinData !== undefined && { input: stdinData }),
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    const extracted: Record<string, unknown> = {};
    if (action.extract) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        // stdout is not JSON — extract finds nothing
      }
      for (const [targetKey, sourceKey] of Object.entries(action.extract)) {
        if (sourceKey === ".") {
          extracted[targetKey] = parsed;
        } else if (sourceKey in parsed) {
          extracted[targetKey] = parsed[sourceKey];
        }
      }
    }

    const trimmed = secretValues.size > 0 ? redactSecrets(stdout.trim(), secretValues) : stdout.trim();
    return { stdout: trimmed, extracted };
  } finally {
    cleanupFile(ctxFile);
  }
}

// ── Dispatcher ──

/**
 * Execute a single action, dispatching to the appropriate handler.
 */
export function executeAction(
  action: ActionDef,
  context: Record<string, unknown>,
  pipe?: PipeInput,
): ActionResult {
  if (isJsAction(action)) return executeJsAction(action, context, pipe);
  if (isShellAction(action)) return executeShellAction(action, context, pipe);
  throw new Error("Invalid action: must have 'js' or 'shell'");
}

// ── Sequential executor with pipe flow ──

/**
 * Execute actions sequentially with pipe-style data flow.
 *
 * - `js:` return values are merged into the running context
 * - `shell:` stdout flows as stdin to the next `shell:` action,
 *   or as `context.stdout` to the next `js:` action
 * - `extract:` overrides default pipe behavior
 */
export function executeActions(
  actions: ActionDef[],
  context: Record<string, unknown>,
): Record<string, unknown> {
  const accumulated: Record<string, unknown> = {};
  const runningContext = { ...context };
  let pipe: PipeInput | undefined;

  for (const action of actions) {
    const result = executeAction(action, runningContext, pipe);
    Object.assign(accumulated, result.extracted);
    Object.assign(runningContext, result.extracted);

    pipe = { stdout: result.stdout };
  }

  return accumulated;
}
