import * as fs from "node:fs";
import * as path from "node:path";
import { instanceDir } from "../audit/logger.js";
import type { AuditEntry } from "../types.js";
import { loadInstanceAny } from "../engine/workflow-any.js";

export function runLog(instanceId: string, stepFilter?: string, follow?: boolean): void {
  const { state } = loadInstanceAny(instanceId);
  const dir = instanceDir(state.workflow_name, state.id);
  const logPath = path.resolve(dir, "audit.jsonl");

  if (!fs.existsSync(logPath)) {
    console.log("No audit log found for this instance.");
    if (!follow) return;
  }

  let printedLines = 0;
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, "utf-8").trim();
    if (content) {
      const lines = content.split("\n");
      for (const line of lines) {
        const entry: AuditEntry = JSON.parse(line);
        if (stepFilter && entry.step_id !== stepFilter && entry.step_id) continue;
        printEntry(entry);
      }
      printedLines = lines.length;
    }
  }

  if (!follow) return;

  let lastSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;

  fs.watchFile(logPath, { interval: 500 }, () => {
    if (!fs.existsSync(logPath)) return;
    const stat = fs.statSync(logPath);
    if (stat.size <= lastSize) return;

    const fd = fs.openSync(logPath, "r");
    const buf = Buffer.alloc(stat.size - lastSize);
    fs.readSync(fd, buf, 0, buf.length, lastSize);
    fs.closeSync(fd);
    lastSize = stat.size;

    const newContent = buf.toString("utf-8").trim();
    if (!newContent) return;

    for (const line of newContent.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry: AuditEntry = JSON.parse(line);
        if (stepFilter && entry.step_id !== stepFilter && entry.step_id) continue;
        printEntry(entry);

        if (entry.event === "workflow_completed" || entry.event === "workflow_error") {
          fs.unwatchFile(logPath);
          process.exit(0);
        }
      } catch {
        // skip malformed lines
      }
    }
  });

  process.on("SIGINT", () => {
    fs.unwatchFile(logPath);
    process.exit(0);
  });

  void printedLines;
}

function printEntry(entry: AuditEntry): void {
  const time = entry.timestamp.replace("T", " ").replace(/\.\d+Z$/, "");
  const step = entry.step_id ? ` [${entry.step_id}]` : "";
  const icon = eventIcon(entry.event);
  const detail = formatDetail(entry);
  console.log(`${time}  ${icon} ${entry.event}${step}${detail}`);
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
    case "step_reset": return "↺";
    case "workflow_completed": return "★";
    case "workflow_error": return "!";
    default: return "·";
  }
}

function formatDetail(entry: AuditEntry): string {
  if (!entry.data) return "";

  if (entry.event === "created") {
    const wf = entry.data.workflow_name || "";
    const input = entry.data.input;
    if (input && typeof input === "object" && Object.keys(input as object).length > 0) {
      return `  ${wf} (${Object.entries(input as object).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`;
    }
    return `  ${wf}`;
  }

  if (entry.event === "step_rejected" || entry.event === "assertion_failed") {
    const errors = entry.data.errors as string[];
    if (errors) return `  ${errors.join("; ")}`;
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

  if (entry.event === "workflow_error") {
    return `  ${entry.data.message ?? ""}`;
  }

  return "";
}
