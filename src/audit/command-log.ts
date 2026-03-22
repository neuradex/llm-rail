import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandLogEntry } from "../types.js";
import { ensureDir, nowISO } from "../util.js";

const LOG_FILE = "command.jsonl";

function logPath(): string {
  return path.resolve(".llm-rail", LOG_FILE);
}

export function appendCommandLog(args: string[]): void {
  const dir = path.resolve(".llm-rail");
  ensureDir(dir);

  const entry: CommandLogEntry = {
    timestamp: nowISO(),
    command: args.join(" "),
    cwd: process.cwd(),
  };

  fs.appendFileSync(logPath(), JSON.stringify(entry) + "\n", "utf-8");
}

export function readCommandLog(): CommandLogEntry[] {
  const p = logPath();
  if (!fs.existsSync(p)) return [];

  const content = fs.readFileSync(p, "utf-8").trim();
  if (!content) return [];

  return content.split("\n").map((line) => JSON.parse(line) as CommandLogEntry);
}
