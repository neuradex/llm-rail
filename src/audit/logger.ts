import * as fs from "node:fs";
import * as path from "node:path";
import type { AuditEntry } from "../types.js";
import { ensureDir, nowISO } from "../util.js";

const LOGS_DIR = path.resolve(".llm-rail", "logs");

export function appendLog(
  instanceId: string,
  event: string,
  stepId?: string,
  data?: Record<string, unknown>,
): void {
  ensureDir(LOGS_DIR);

  const entry: AuditEntry = {
    timestamp: nowISO(),
    instance_id: instanceId,
    event,
    ...(stepId && { step_id: stepId }),
    ...(data && { data }),
  };

  const logPath = path.resolve(LOGS_DIR, `${instanceId}.jsonl`);
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
