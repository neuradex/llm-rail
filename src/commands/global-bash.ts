import { execFileSync } from "node:child_process";
import { loadLrailConfig } from "../engine/gateway.js";
import { evaluatePolicy } from "../engine/policy.js";
import { appendCommandLog } from "../audit/command-log.js";
import { buildSanitizedEnv, resolveAllSecrets, redactSecrets } from "../engine/secrets.js";

/**
 * Global bash proxy: `lrail bash '<command>'`
 * Runs without instance context. Applies project policy + env mediation.
 */
export function runGlobalBash(command: string): void {
  const config = loadLrailConfig();

  // 1. Policy check
  if (config?.policy) {
    const result = evaluatePolicy(config.policy, command);
    if (!result.allowed) {
      try { appendCommandLog([command], "hook", true); } catch { /* best-effort */ }
      console.error(`Policy denied: ${result.reason}`);
      console.error(`Command: ${command}`);
      process.exit(1);
    }
  }

  // 2. Env mediation
  const envPolicy = config?.env;
  const secretValues = envPolicy
    ? resolveAllSecrets(envPolicy)
    : new Map<string, string>();
  const subEnv = envPolicy ? buildSanitizedEnv(envPolicy, secretValues) : undefined;

  // 3. Execute
  try {
    const stdout = execFileSync("bash", ["-c", command], {
      encoding: "utf-8",
      timeout: 30_000,
      ...(subEnv && { env: subEnv }),
      stdio: ["inherit", "pipe", "pipe"],
    });
    try { appendCommandLog([command], "hook"); } catch { /* best-effort */ }
    if (stdout.trim()) {
      const output = secretValues.size > 0 ? redactSecrets(stdout.trimEnd(), secretValues) : stdout.trimEnd();
      console.log(output);
    }
  } catch (err: unknown) {
    try { appendCommandLog([command], "hook", false, true); } catch { /* best-effort */ }

    if (err && typeof err === "object") {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      if (e.stdout?.trim()) {
        const out = secretValues.size > 0 ? redactSecrets(e.stdout.trimEnd(), secretValues) : e.stdout.trimEnd();
        console.log(out);
      }
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
