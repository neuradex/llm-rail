import * as fs from "node:fs";
import * as path from "node:path";
import type { PolicyDef, CommandPattern } from "../types.js";
import { instanceDir } from "../audit/logger.js";
import { ensureDir, nowISO } from "../util.js";

export interface PolicyResult {
  allowed: boolean;
  reason: string;
}

/**
 * Evaluate a command against a policy definition.
 * Deny-first: check deny rules → check allow rules → implicit deny.
 * Trail mode always allows.
 */
export function evaluatePolicy(policy: PolicyDef, command: string): PolicyResult {
  if (policy.mode === "trail") {
    return { allowed: true, reason: "trail mode: all commands logged" };
  }

  // Normalize line continuations (backslash + newline + leading whitespace)
  // to a single space, matching shell word-splitting semantics. Replacing
  // with the empty string would let an attacker collapse `rm -rf\<NL> *`
  // into `rm -rf*`, slipping past a `rm -rf *` rule.
  command = command.replace(/\\\n\s*/g, " ");

  // Enforce mode
  const defaultEffect = policy.default || "deny";

  if (!policy.rules || policy.rules.length === 0) {
    if (defaultEffect === "allow") {
      return { allowed: true, reason: "no rules defined, default allow" };
    }
    return { allowed: false, reason: "no rules defined, default deny" };
  }

  // Check deny rules first
  for (const rule of policy.rules) {
    if (rule.effect === "deny") {
      for (const pattern of rule.commands) {
        if (matchCommand(pattern, command)) {
          return { allowed: false, reason: `denied by rule: ${patternLabel(pattern)}` };
        }
      }
    }
  }

  // Check allow rules
  for (const rule of policy.rules) {
    if (rule.effect === "allow") {
      for (const pattern of rule.commands) {
        if (matchCommand(pattern, command)) {
          return { allowed: true, reason: `allowed by rule: ${patternLabel(pattern)}` };
        }
      }
    }
  }

  // Default
  if (defaultEffect === "allow") {
    return { allowed: true, reason: "no matching rule, default allow" };
  }
  return { allowed: false, reason: "no matching rule, default deny" };
}

/**
 * Match a command against a pattern (glob string or regex object).
 */
export function matchCommand(pattern: CommandPattern, command: string): boolean {
  if (typeof pattern === "string") {
    return matchGlob(pattern, command);
  }
  return matchRegex(pattern.regex, command);
}

/**
 * Minimal glob matching: supports * as wildcard for any characters.
 */
export function matchGlob(pattern: string, str: string): boolean {
  // Escape regex special chars, then replace \* with .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return re.test(str);
}

/**
 * Regex matching: pattern is tested against the full command string.
 */
export function matchRegex(pattern: string, str: string): boolean {
  try {
    const re = new RegExp(pattern);
    return re.test(str);
  } catch {
    // Invalid regex — treat as non-match
    return false;
  }
}

/**
 * Human-readable label for a pattern (used in deny/allow reasons).
 */
function patternLabel(pattern: CommandPattern): string {
  if (typeof pattern === "string") return pattern;
  return `regex:${pattern.regex}`;
}

/**
 * Append a policy evaluation entry to the policy log.
 */
export function appendPolicyLog(
  workflowName: string,
  instanceId: string,
  stepId: string,
  command: string,
  allowed: boolean,
): void {
  const dir = instanceDir(workflowName, instanceId);
  ensureDir(dir);

  const entry = {
    timestamp: nowISO(),
    step_id: stepId,
    command,
    allowed,
  };

  const logPath = path.resolve(dir, "proxy.jsonl");
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
