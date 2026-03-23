import * as fs from "node:fs";
import * as path from "node:path";
import { loadInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { evaluatePolicy } from "../engine/policy.js";
import { instanceDir } from "../audit/logger.js";
import { checkCommand, loadProjectPolicy } from "../engine/gateway.js";
import { resolveAllSecrets, matchSecretFilePath, checkFileForSecrets } from "../engine/secrets.js";

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
  const state = loadInstance(instanceId);
  const dir = instanceDir(state.workflow_name, instanceId);
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
      // Extract the base command (first word)
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
  const def = loadWorkflow(workflowName);

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
 * Used by the plugin hook for main agent enforcement.
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
 * Check if env mediation is configured in project policy.
 * Exit code: 0 = env mediation is active (inject or secret_files), 1 = not configured.
 */
export function runPolicyHasEnv(): void {
  const policy = loadProjectPolicy();
  const env = policy?.env;
  if (
    (env?.inject && env.inject.length > 0) ||
    (env?.secret_files && env.secret_files.length > 0)
  ) {
    process.exit(0);
  }
  process.exit(1);
}

/**
 * Check if a file is blocked by env policy (secret_files path match or content scan).
 * Exit code: 0 = allowed, 1 = blocked.
 */
export function runPolicyCheckFile(filePath: string): void {
  const policy = loadProjectPolicy();
  if (!policy?.env) {
    process.exit(0);
  }

  // Check secret_files path match
  if (policy.env.secret_files && matchSecretFilePath(filePath, policy.env.secret_files)) {
    console.error(JSON.stringify({ allowed: false, reason: `Path matches secret_files: ${filePath}` }));
    process.exit(1);
  }

  // Check file contents for secret values (inject + secret_files-derived)
  const secrets = resolveAllSecrets(policy.env);
  if (secrets.size > 0) {
    const result = checkFileForSecrets(filePath, secrets);
    if (result.blocked) {
      console.error(JSON.stringify({ allowed: false, reason: result.reason }));
      process.exit(1);
    }
  }

  process.exit(0);
}
