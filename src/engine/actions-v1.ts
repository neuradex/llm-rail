import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { V1ActionDef } from "../types-v1.js";

// ── Result types ──

export interface V1ActionResult {
  stdout: string;
  extracted: Record<string, unknown>;
}

export interface V1ActionsResult {
  extracted: Record<string, unknown>;
  stdout?: string;
}

interface PipeInput {
  stdout?: string;
}

// ── Helpers ──

function tmpFile(prefix: string, ext: string): string {
  return path.join(
    os.tmpdir(),
    `lrail-v1-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
  );
}

function cleanupFile(p?: string): void {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

/**
 * Resolve `{{field}}` templates in a shell command against the running context.
 * Complex values are JSON-stringified; undefined fields are left as literals so
 * the user can spot unresolved templates in the emitted command.
 */
export function resolveShellCommand(cmd: string, context: Record<string, unknown>): string {
  return cmd.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in context)) return `{{${key}}}`;
    const val = context[key];
    if (val === null || val === undefined) return "";
    return typeof val === "object" ? JSON.stringify(val) : String(val);
  });
}

// ── JS action (v1: pure function — no lrail injection) ──

/**
 * Execute a v1 `js:` action.
 *
 * The user's code is wrapped in an async IIFE that receives `context`
 * (the resolved context_in + any piped data from prior actions) as an
 * in-scope constant. Returning an object merges into the step's output;
 * returning undefined/null contributes nothing.
 *
 * Deliberately absent: `lrail.set/get/goto`. In v1 all data flow is
 * through step outputs and context_in. Calling these names will throw
 * a plain ReferenceError at runtime.
 */
function executeJsActionV1(
  action: V1ActionDef,
  context: Record<string, unknown>,
  pipe: PipeInput | undefined,
  timeoutMs: number,
): V1ActionResult {
  const ctx = { ...context };
  if (pipe?.stdout !== undefined) {
    ctx.stdout = pipe.stdout;
  }

  const ctxFile = tmpFile("ctx", ".json");
  const scriptFile = tmpFile("js", ".mjs");

  try {
    fs.writeFileSync(ctxFile, JSON.stringify(ctx), "utf-8");

    // Note: no `lrail` object. User code runs against `context` only.
    const wrapper = `
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";

const context = JSON.parse(readFileSync(${JSON.stringify(ctxFile)}, "utf8"));

const __result = await (async () => {
${action.js}
})();

if (__result !== undefined && __result !== null) {
  process.stdout.write(typeof __result === "string" ? __result : JSON.stringify(__result));
}
`;
    fs.writeFileSync(scriptFile, wrapper, "utf-8");

    const stdout = execFileSync("node", [scriptFile], {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const trimmed = stdout.trim();
    const extracted: Record<string, unknown> = {};

    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(extracted, parsed);
        }
      } catch {
        // Non-JSON stdout — stays in stdout, doesn't contribute to output
      }
    }

    return { stdout: trimmed, extracted };
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    const stderr = err.stderr?.trim() || "";
    const meaningful = stderr
      .split("\n")
      .filter((l) => !l.startsWith("    at ") && l.trim() !== "")
      .join("\n");
    throw new Error(
      `js action '${action.name}' failed:\n${meaningful || err.message || "unknown error"}`,
    );
  } finally {
    cleanupFile(ctxFile);
    cleanupFile(scriptFile);
  }
}

// ── Shell action ──

/**
 * Execute a v1 `shell:` action. Semantics mirror the legacy shell action:
 * {{field}} template resolution, CONTEXT / CONTEXT_FILE env, optional
 * `extract:` mapping from JSON stdout.
 */
function executeShellActionV1(
  action: V1ActionDef,
  context: Record<string, unknown>,
  pipe: PipeInput | undefined,
  timeoutMs: number,
): V1ActionResult {
  const resolved = resolveShellCommand(action.shell!, context);
  const contextJson = JSON.stringify(context);

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  let ctxFile: string | undefined;

  if (contextJson.length <= 8192) {
    env.CONTEXT = contextJson;
  } else {
    ctxFile = tmpFile("ctx", ".json");
    fs.writeFileSync(ctxFile, contextJson, "utf-8");
    env.CONTEXT_FILE = ctxFile;
  }

  try {
    const stdinData = pipe?.stdout;
    let stdout: string;
    try {
      stdout = execFileSync("sh", ["-c", resolved], {
        ...(stdinData !== undefined && { input: stdinData }),
        encoding: "utf-8",
        timeout: timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
    } catch (err: unknown) {
      const e = err as { code?: string; status?: number | null; stdout?: string };
      if (e.code === "EPIPE" && (e.status === 0 || e.status === null)) {
        stdout = (e.stdout as string) ?? "";
      } else {
        throw err;
      }
    }

    const trimmed = stdout.trim();
    const extracted: Record<string, unknown> = {};

    if (action.extract) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // stdout not JSON; nothing to extract
      }
      for (const [targetKey, sourceKey] of Object.entries(action.extract)) {
        if (sourceKey === ".") {
          extracted[targetKey] = parsed;
        } else if (sourceKey in parsed) {
          extracted[targetKey] = parsed[sourceKey];
        }
      }
    }

    return { stdout: trimmed, extracted };
  } finally {
    cleanupFile(ctxFile);
  }
}

// ── Dispatcher ──

function hasJs(a: V1ActionDef): boolean {
  return typeof a.js === "string" && a.js.trim() !== "";
}
function hasShell(a: V1ActionDef): boolean {
  return typeof a.shell === "string" && a.shell.trim() !== "";
}

function executeSingleV1(
  action: V1ActionDef,
  context: Record<string, unknown>,
  pipe: PipeInput | undefined,
  timeoutMs: number,
): V1ActionResult {
  if (hasJs(action)) return executeJsActionV1(action, context, pipe, timeoutMs);
  if (hasShell(action)) return executeShellActionV1(action, context, pipe, timeoutMs);
  throw new Error(`action '${action.name}' has neither 'js' nor 'shell'`);
}

/**
 * Execute v1 actions sequentially with pipe-style data flow.
 *
 *  - js return → merged into running context + accumulated output
 *  - shell stdout → piped as stdin to next shell, or as context.stdout to next js
 *  - shell.extract → extracted fields merged into context + output
 *
 * No goto, no side-effect store. The final accumulated object is the
 * programmatic step's proposed output, which the runner then validates
 * against `required_output`.
 */
export function executeV1Actions(
  actions: V1ActionDef[],
  initialContext: Record<string, unknown>,
  timeoutMs: number,
): V1ActionsResult {
  const accumulated: Record<string, unknown> = {};
  const runningContext = { ...initialContext };
  let pipe: PipeInput | undefined;
  let lastStdout: string | undefined;

  for (const action of actions) {
    const result = executeSingleV1(action, runningContext, pipe, timeoutMs);
    Object.assign(accumulated, result.extracted);
    Object.assign(runningContext, result.extracted);
    lastStdout = result.stdout;

    // Pipe convention for the next action:
    // - if next is shell, feed stdout as stdin (set via PipeInput)
    // - if next is js, make stdout available as context.stdout
    pipe = { stdout: result.stdout };
  }

  return { extracted: accumulated, stdout: lastStdout };
}
