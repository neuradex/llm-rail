import { execFileSync } from "node:child_process";
import { loadInstanceAny } from "../engine/workflow-any.js";
import { loadWorkflowV1 } from "../engine/workflow-v1.js";
import { checkCommand } from "../engine/gateway.js";
import { appendCommandLog } from "../audit/command-log.js";

export function runBash(id: string, command: string): void {
  const { state } = loadInstanceAny(id);
  const def = loadWorkflowV1(state.workflow_name);

  const stepId = state.current_step_id ?? "unknown";

  const result = checkCommand(command, {
    workflowName: state.workflow_name,
    instanceId: state.id,
    stepId,
    policy: def.policy,
  });

  if (!result.allowed) {
    console.error(`Policy denied: ${result.reason}`);
    console.error(`Command: ${command}`);
    process.exit(1);
  }

  try {
    const stdout = execFileSync("bash", ["-c", command], {
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

    if (err && typeof err === "object") {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      if (e.stderr?.trim()) {
        console.error(e.stderr.trimEnd());
      }
      process.exit(typeof e.status === "number" ? e.status : 1);
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error(`Command failed: ${message}`);
    process.exit(1);
  }
}
