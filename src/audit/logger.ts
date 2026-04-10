import * as fs from "node:fs";
import * as path from "node:path";
import type { AuditEntry } from "../types.js";
import { ensureDir, getDataDir, nowISO } from "../util.js";

export function instanceDir(workflowName: string, instanceId: string): string {
  return path.resolve(getDataDir(), workflowName, instanceId);
}

export function appendLog(
  workflowName: string,
  instanceId: string,
  event: string,
  stepId?: string,
  data?: Record<string, unknown>,
): void {
  const dir = instanceDir(workflowName, instanceId);
  ensureDir(dir);

  const entry: AuditEntry = {
    timestamp: nowISO(),
    instance_id: instanceId,
    event,
    ...(stepId && { step_id: stepId }),
    ...(data && { data }),
  };

  const logPath = path.resolve(dir, "audit.jsonl");
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
