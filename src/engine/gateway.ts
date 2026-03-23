import * as fs from "node:fs";
import * as path from "node:path";
import type { PolicyDef } from "../types.js";
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
  const projectPolicy = loadProjectPolicy();
  if (projectPolicy) {
    const result = evaluatePolicy(projectPolicy, command);
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

export function loadProjectPolicy(): PolicyDef | null {
  const p = path.resolve("lrail.yml");
  if (!fs.existsSync(p)) return null;
  return loadYaml<PolicyDef>(p);
}
