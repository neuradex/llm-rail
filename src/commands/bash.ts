import { execFileSync } from "node:child_process";
import { loadInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { checkCommand, loadLrailConfig } from "../engine/gateway.js";
import { appendCommandLog } from "../audit/command-log.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";
import { buildSanitizedEnv, resolveAllSecrets, redactSecrets, mergeEnvPolicies } from "../engine/secrets.js";

export function runBash(id: string, command: string): void {
  const state = loadInstance(id);
  const def = loadWorkflow(state.workflow_name, state.variant);

  const currentStep = def.steps[state.current_step];
  const stepId = currentStep?.id || "unknown";

  const result = checkCommand(command, {
    workflowName: state.workflow_name,
    instanceId: state.id,
    stepId,
    policy: def.policy,
  });

  if (!result.allowed) {
    fireHook(
      makeHookPayload("policy:denied", state.id, state.workflow_name, stepId, {
        command,
        reason: result.reason,
      }),
    );
    console.error(`Policy denied: ${result.reason}`);
    console.error(`Command: ${command}`);
    process.exit(1);
  }

  // Env mediation: merge project + workflow env policies
  const config = loadLrailConfig();
  const envPolicy = mergeEnvPolicies(config?.env, def.policy?.env);
  const secretValues = envPolicy
    ? resolveAllSecrets(envPolicy)
    : new Map<string, string>();
  const subEnv = envPolicy ? buildSanitizedEnv(envPolicy, secretValues) : undefined;

  try {
    const stdout = execFileSync("bash", ["-c", command], {
      encoding: "utf-8",
      timeout: 30_000,
      ...(subEnv && { env: subEnv }),
      stdio: ["inherit", "pipe", "pipe"],
    });
    try { appendCommandLog([command], "instance"); } catch { /* best-effort */ }
    if (stdout.trim()) {
      const output = secretValues.size > 0 ? redactSecrets(stdout.trimEnd(), secretValues) : stdout.trimEnd();
      console.log(output);
    }
  } catch (err: unknown) {
    try { appendCommandLog([command], "instance", false, true); } catch { /* best-effort */ }

    if (err && typeof err === "object") {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      if (e.stderr?.trim()) {
        const errOut = secretValues.size > 0 ? redactSecrets(e.stderr.trimEnd(), secretValues) : e.stderr.trimEnd();
        console.error(errOut);
      }
      process.exit(typeof e.status === "number" ? e.status : 1);
    }

    const message = err instanceof Error ? err.message : String(err);
    const redactedMsg = secretValues.size > 0 ? redactSecrets(message, secretValues) : message;
    console.error(`Command failed: ${redactedMsg}`);
    process.exit(1);
  }
}
