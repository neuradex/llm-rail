import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandLogEntry } from "../types.js";
import { ensureDir, nowISO } from "../util.js";

const LOG_FILE = "command.jsonl";

function logPath(): string {
  return path.resolve(".llm-rail", LOG_FILE);
}

export function appendCommandLog(
  args: string[],
  source: "cli" | "hook" | "instance" = "cli",
  denied?: boolean,
  error?: boolean,
): void {
  const dir = path.resolve(".llm-rail");
  ensureDir(dir);

  const entry: CommandLogEntry = {
    timestamp: nowISO(),
    command: args.join(" "),
    cwd: process.cwd(),
    source,
    ...(denied && { denied }),
    ...(error && { error }),
  };

  fs.appendFileSync(logPath(), JSON.stringify(entry) + "\n", "utf-8");
}

export function readCommandLog(): CommandLogEntry[] {
  const p = logPath();
  if (!fs.existsSync(p)) return [];

  const content = fs.readFileSync(p, "utf-8").trim();
  if (!content) return [];

  const entries: CommandLogEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as CommandLogEntry);
    } catch {
      // Skip malformed lines (e.g. multiline commands split across lines)
    }
  }
  return entries;
}
