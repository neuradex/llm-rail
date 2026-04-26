import * as fs from "node:fs";
import * as path from "node:path";
import { evaluatePolicy } from "../engine/policy.js";
import { instanceDir } from "../audit/logger.js";
import { checkCommand, loadLrailConfig } from "../engine/gateway.js";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";

interface PolicyLogEntry {
  timestamp: string;
  step_id: string;
  command: string;
  allowed: boolean;
}

/**
 * Read proxy.jsonl and generate a minimal allow-list from observed commands.
 */
export function runPolicyGenerate(instanceId: string): void {
  const { state } = loadInstanceAny(instanceId);
  const dir = instanceDir(state.workflow_name, state.id);
  const logPath = path.resolve(dir, "proxy.jsonl");

  if (!fs.existsSync(logPath)) {
    console.error("No policy log found. Run commands in trail mode first.");
    process.exit(1);
  }

  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  const commands = new Set<string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as PolicyLogEntry;
      const base = entry.command.split(/\s+/)[0];
      commands.add(`${base} *`);
    } catch {
      // skip invalid lines
    }
  }

  if (commands.size === 0) {
    console.log("No commands found in policy log.");
    return;
  }

  console.log("Generated allow-list:");
  console.log("");
  console.log("policy:");
  console.log("  mode: enforce");
  console.log("  rules:");
  console.log("    - effect: allow");
  console.log("      commands:");
  for (const cmd of commands) {
    console.log(`        - "${cmd}"`);
  }
}

/**
 * Dry-run check: evaluate a command against a workflow's policy.
 */
export function runPolicyCheck(workflowName: string, command: string): void {
  const def = loadWorkflowV1(workflowName);

  if (!def.policy) {
    console.log("No policy defined for this workflow. All commands allowed.");
    return;
  }

  const result = evaluatePolicy(def.policy, command);
  console.log(`Command: ${command}`);
  console.log(`Result: ${result.allowed ? "ALLOWED" : "DENIED"}`);
  console.log(`Reason: ${result.reason}`);
}

/**
 * Evaluate a command against the project-level policy (lrail.yml).
 * Exit code: 0 = allow, 1 = deny.
 */
export function runPolicyEval(command: string): void {
  const result = checkCommand(command);

  if (result.allowed) {
    process.exit(0);
  } else {
    console.error(`✗ DENIED: ${command}`);
    console.error(`  ${result.reason}`);
    process.exit(1);
  }
}

/**
 * Check if lrail.yml is visible to agents.
 * Exit code: 0 = visible (reading allowed), 1 = not visible (reading blocked).
 */
export function runPolicyVisible(): void {
  const config = loadLrailConfig();
  if (config?.visible === true) {
    process.exit(0);
  }
  process.exit(1);
}
