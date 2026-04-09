import { execFileSync } from "node:child_process";
import { loadLrailConfig } from "../engine/gateway.js";
import { evaluatePolicy } from "../engine/policy.js";
import { appendCommandLog } from "../audit/command-log.js";

/**
 * Global bash proxy: `lrail bash '<command>'`
 * Runs without instance context. Applies project policy.
 */
export function runGlobalBash(command: string): void {
  const config = loadLrailConfig();

  if (config?.policy) {
    const result = evaluatePolicy(config.policy, command);
    if (!result.allowed) {
      try { appendCommandLog([command], "hook", true); } catch { /* best-effort */ }
      console.error(`Policy denied: ${result.reason}`);
      console.error(`Command: ${command}`);
      process.exit(1);
    }
  }

  try {
    const stdout = execFileSync("bash", ["-c", command], {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["inherit", "pipe", "pipe"],
    });
    try { appendCommandLog([command], "hook"); } catch { /* best-effort */ }
    if (stdout.trim()) {
      console.log(stdout.trimEnd());
    }
  } catch (err: unknown) {
    try { appendCommandLog([command], "hook", false, true); } catch { /* best-effort */ }

    if (err && typeof err === "object") {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      if (e.stdout?.trim()) console.log(e.stdout.trimEnd());
      if (e.stderr?.trim()) console.error(e.stderr.trimEnd());
      process.exit(typeof e.status === "number" ? e.status : 1);
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error(`Command failed: ${message}`);
    process.exit(1);
  }
}
