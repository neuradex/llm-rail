import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LrailGoto } from "../types.js";
import type { ActionDef, JsActionDef, ShellActionDef } from "../types.js";

// ── Type guards ──

function isJsAction(a: ActionDef): a is JsActionDef { return "js" in a; }
function isShellAction(a: ActionDef): a is ShellActionDef { return "shell" in a; }

// ── Result types ──

export interface ActionResult {
  stdout: string;
  extracted: Record<string, unknown>;
  goto?: LrailGoto;
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
 * The user's code receives `lrail` builtin with get/set/goto methods.
 * - lrail.get()       → entire context
 * - lrail.get("key")  → context[key]
 * - lrail.set({k: v}) → merge into context (side effect)
 * - lrail.goto("id")  → return LrailGoto (flow control)
 *
 * Context is passed via a temp file — no env var size limits.
 * The lrail.set() mutations are written back to a separate file.
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
  const mutFile = tmpFile("mut", ".json");
  const scriptFile = tmpFile("js", ".mjs");

  try {
    fs.writeFileSync(ctxFile, JSON.stringify(ctx), "utf-8");
    fs.writeFileSync(mutFile, "{}", "utf-8");

    const wrapper = `
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";

const __ctx = JSON.parse(readFileSync(${JSON.stringify(ctxFile)}, "utf8"));
const __mutations = {};
const __GOTO_BRAND = "__lrail_goto__";

const lrail = {
  get(key) {
    if (key === undefined) return { ...__ctx };
    return __ctx[key];
  },
  set(obj) {
    if (typeof obj !== "object" || obj === null) throw new Error("lrail.set() requires an object");
    Object.assign(__ctx, obj);
    Object.assign(__mutations, obj);
  },
  goto(target) {
    if (typeof target !== "string") throw new Error("lrail.goto() requires a step ID string");
    return { __brand: __GOTO_BRAND, target };
  },
};

const __result = await (async () => {
${action.js}
})();

// Write mutations back
writeFileSync(${JSON.stringify(mutFile)}, JSON.stringify(__mutations));

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

    // Read back mutations from lrail.set()
    const mutations: Record<string, unknown> = JSON.parse(fs.readFileSync(mutFile, "utf-8"));

    const extracted: Record<string, unknown> = {};
    const trimmed = stdout.trim();
    let goto: LrailGoto | undefined;

    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          if (parsed.__brand === "__lrail_goto__" && typeof parsed.target === "string") {
            goto = new LrailGoto(parsed.target);
          } else {
            Object.assign(extracted, parsed);
          }
        }
      } catch {
        // Non-JSON return — ignore
      }
    }

    // Merge lrail.set() mutations into extracted
    Object.assign(extracted, mutations);

    return { stdout: trimmed, extracted, goto };
  } catch (e: unknown) {
    const err = e as { stderr?: string; status?: number; message?: string };
    const stderr = err.stderr?.trim() || "";
    const lines = stderr.split("\n");
    const meaningful = lines.filter(l => !l.startsWith("    at ") && l.trim() !== "").join("\n");
    throw new Error(`js action failed:\n${meaningful || err.message || "unknown error"}`);
  } finally {
    cleanupFile(ctxFile);
    cleanupFile(mutFile);
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
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  if (contextJson.length <= 8192) {
    env.CONTEXT = contextJson;
  } else {
    ctxFile = tmpFile("ctx", ".json");
    fs.writeFileSync(ctxFile, contextJson, "utf-8");
    env.CONTEXT_FILE = ctxFile;
  }

  try {
    const stdinData = pipe?.stdout;
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

    const trimmed = stdout.trim();
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

export interface ActionsResult {
  extracted: Record<string, unknown>;
  goto?: LrailGoto;
}

/**
 * Execute actions sequentially with pipe-style data flow.
 *
 * - `js:` return values are merged into the running context
 * - `shell:` stdout flows as stdin to the next `shell:` action,
 *   or as `context.stdout` to the next `js:` action
 * - `extract:` overrides default pipe behavior
 * - If any action returns lrail.goto(), the chain stops and goto is propagated
 */
export function executeActions(
  actions: ActionDef[],
  context: Record<string, unknown>,
): ActionsResult {
  const accumulated: Record<string, unknown> = {};
  const runningContext = { ...context };
  let pipe: PipeInput | undefined;

  for (const action of actions) {
    const result = executeAction(action, runningContext, pipe);
    Object.assign(accumulated, result.extracted);
    Object.assign(runningContext, result.extracted);

    if (result.goto) {
      return { extracted: accumulated, goto: result.goto };
    }

    pipe = { stdout: result.stdout };
  }

  return { extracted: accumulated };
}
