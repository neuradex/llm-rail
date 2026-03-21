import * as fs from "node:fs";
import * as path from "node:path";
import { loadInstance } from "../engine/state.js";
import { instanceDir } from "../audit/logger.js";
import type { AuditEntry } from "../types.js";

export function runLog(instanceId: string, stepFilter?: string): void {
  const state = loadInstance(instanceId);
  const dir = instanceDir(state.workflow_name, instanceId);
  const logPath = path.resolve(dir, "audit.jsonl");

  if (!fs.existsSync(logPath)) {
    console.log("No audit log found for this instance.");
    return;
  }

  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  const entries: AuditEntry[] = lines.map((l) => JSON.parse(l));

  const filtered = stepFilter
    ? entries.filter((e) => e.step_id === stepFilter || !e.step_id)
    : entries;

  if (filtered.length === 0) {
    console.log("No log entries found.");
    return;
  }

  for (const entry of filtered) {
    const time = entry.timestamp.replace("T", " ").replace(/\.\d+Z$/, "");
    const step = entry.step_id ? ` [${entry.step_id}]` : "";
    const icon = eventIcon(entry.event);
    const detail = formatDetail(entry);

    console.log(`${time}  ${icon} ${entry.event}${step}${detail}`);
  }
}

function eventIcon(event: string): string {
  switch (event) {
    case "created": return "+";
    case "step_started": return ">";
    case "step_completed": return "✓";
    case "step_auto_completed": return "⚙";
    case "step_rejected": return "✗";
    case "assertion_failed": return "✗";
    case "script_assertion": return "⚡";
    case "action_failed": return "!";
    case "step_reset": return "↺";
    case "workflow_completed": return "★";
    default: return "·";
  }
}

function formatDetail(entry: AuditEntry): string {
  if (!entry.data) return "";

  if (entry.event === "created") {
    const wf = entry.data.workflow_name || "";
    const params = entry.data.params;
    if (params && typeof params === "object" && Object.keys(params as object).length > 0) {
      return `  ${wf} (${Object.entries(params as object).map(([k, v]) => `${k}=${v}`).join(", ")})`;
    }
    return `  ${wf}`;
  }

  if (entry.event === "step_rejected" || entry.event === "assertion_failed") {
    const errors = entry.data.errors as string[];
    if (errors) return `  ${errors.join("; ")}`;
  }

  if (entry.event === "action_failed") {
    return `  ${entry.data.error || ""}`;
  }

  if (entry.event === "script_assertion") {
    const logs = entry.data.logs as Array<{ field: string; exit_code: number; stdout: string; stderr: string }>;
    if (!logs) return "";
    return logs.map((l) => {
      const status = l.exit_code === 0 ? "PASS" : `FAIL(${l.exit_code})`;
      const out = l.stdout ? ` stdout=${l.stdout.slice(0, 80)}` : "";
      const err = l.stderr ? ` stderr=${l.stderr.slice(0, 80)}` : "";
      return `  ${l.field}: ${status}${out}${err}`;
    }).join("\n");
  }

  if (entry.event === "step_completed") {
    const output = entry.data.output as Record<string, unknown> | undefined;
    if (!output) return "";
    const keys = Object.keys(output);
    const summary = keys.map((k) => {
      const v = output[k];
      if (Array.isArray(v)) return `${k}[${v.length}]`;
      if (typeof v === "string") return `${k}="${v.slice(0, 30)}${v.length > 30 ? "..." : ""}"`;
      if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
      return k;
    });
    return `  {${summary.join(", ")}}`;
  }

  return "";
}
