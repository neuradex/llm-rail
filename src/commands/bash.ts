import { execFileSync } from "node:child_process";
import { loadInstance } from "../engine/state.js";
import { loadWorkflow } from "../engine/workflow.js";
import { checkCommand } from "../engine/gateway.js";
import { appendCommandLog } from "../audit/command-log.js";
import { fireHook, makeHookPayload } from "../engine/hooks.js";

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

  try {
    const stdout = execFileSync("sh", ["-c", command], {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["inherit", "pipe", "pipe"],
    });
    try { appendCommandLog([command], "instance"); } catch { /* best-effort */ }
    if (stdout.trim()) {
      console.log(stdout.trimEnd());
    }
  } catch (err: unknown) {
    try { appendCommandLog([command], "instance", false, true); } catch { /* best-effort */ }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Command failed: ${message}`);
    process.exit(1);
  }
}
