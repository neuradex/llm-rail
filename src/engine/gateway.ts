import * as fs from "node:fs";
import * as path from "node:path";
import type { LrailConfig, PolicyDef } from "../types.js";
import { loadYaml } from "../util.js";
import { evaluatePolicy, appendPolicyLog, type PolicyResult } from "./policy.js";
import { appendCommandLog } from "../audit/command-log.js";

/**
 * Single gateway for all command execution.
 * Handles logging + policy evaluation for both main agent (hook) and subagent (bash proxy).
 */
export function checkCommand(
  command: string,
  instance?: { workflowName: string; instanceId: string; stepId: string; policy?: PolicyDef },
): PolicyResult {
  const source = instance ? "instance" as const : "hook" as const;

  // 1. Check project-level policy (lrail.yml)
  const config = loadLrailConfig();
  if (config?.policy) {
    const result = evaluatePolicy(config.policy, command);
    if (!result.allowed) {
      try { appendCommandLog([command], source, true); } catch { /* best-effort */ }
      return result;
    }
  }

  // 2. Check workflow-level policy (if instance context)
  if (instance?.policy) {
    const result = evaluatePolicy(instance.policy, command);
    appendPolicyLog(instance.workflowName, instance.instanceId, instance.stepId, command, result.allowed);
    if (!result.allowed) {
      try { appendCommandLog([command], source, true); } catch { /* best-effort */ }
      return result;
    }
  }

  // 3. All passed — log as allowed (hook only; instance logs after execution)
  if (!instance) {
    try { appendCommandLog([command], source); } catch { /* best-effort */ }
  }
  return { allowed: true, reason: "passed" };
}

/**
 * Walk up from cwd to find the nearest lrail.yml.
 */
export function findConfigFile(from?: string): string | null {
  let dir = path.resolve(from || ".");
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, "lrail.yml");
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

/**
 * Load lrail.yml and normalize to LrailConfig.
 * Supports both flat (legacy) and nested formats:
 *
 * Flat (legacy):     { mode, default, rules }
 * Nested (current):  { policy: { mode, default, rules } }
 */
export function loadLrailConfig(): LrailConfig | null {
  const p = findConfigFile();
  if (!p) return null;
  const raw = loadYaml<Record<string, unknown>>(p);
  if (!raw) return null;

  // Nested format: has `policy` key
  if (raw.policy && typeof raw.policy === "object") {
    return raw as unknown as LrailConfig;
  }

  // Flat (legacy) format: mode/rules at top level
  if (raw.mode || raw.rules) {
    return { policy: raw as unknown as PolicyDef };
  }

  return raw as unknown as LrailConfig;
}
