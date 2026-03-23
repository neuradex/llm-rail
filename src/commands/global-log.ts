import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandLogEntry } from "../types.js";
import { readCommandLog } from "../audit/command-log.js";

// ANSI colors
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  bgCyan: "\x1b[46m\x1b[30m",
  bgYellow: "\x1b[43m\x1b[30m",
  bgGreen: "\x1b[42m\x1b[30m",
  bgRed: "\x1b[41m\x1b[37m",
  strikethrough: "\x1b[9m",
};

interface SourceStyle {
  tag: string;
  color: string;
}

function sourceStyle(source?: string): SourceStyle {
  switch (source) {
    case "hook":
      return { tag: " AGENT ", color: c.bgCyan };
    case "instance":
      return { tag: " PROXY ", color: c.bgYellow };
    default:
      return { tag: " CLI ", color: c.bgGreen };
  }
}

export function runGlobalLog(limit?: number, follow?: boolean, raw?: boolean): void {
  const entries = readCommandLog();

  if (entries.length === 0 && !follow) {
    console.log("No command history found.");
    return;
  }

  const printer = raw ? printRawEntry : printEntry;
  const display = limit ? entries.slice(-limit) : entries;
  for (const entry of display) {
    printer(entry);
  }

  if (!follow) return;

  // Follow mode
  const logFile = path.resolve(".llm-rail", "command.jsonl");
  let lastSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;

  fs.watchFile(logFile, { interval: 500 }, () => {
    if (!fs.existsSync(logFile)) return;
    const stat = fs.statSync(logFile);
    if (stat.size <= lastSize) return;

    const fd = fs.openSync(logFile, "r");
    const buf = Buffer.alloc(stat.size - lastSize);
    fs.readSync(fd, buf, 0, buf.length, lastSize);
    fs.closeSync(fd);
    lastSize = stat.size;

    const newContent = buf.toString("utf-8").trim();
    if (!newContent) return;

    for (const line of newContent.split("\n")) {
      if (!line.trim()) continue;
      try {
        printer(JSON.parse(line) as CommandLogEntry);
      } catch {
        // skip malformed lines
      }
    }
  });

  process.on("SIGINT", () => {
    fs.unwatchFile(logFile);
    process.exit(0);
  });
}

function printEntry(entry: CommandLogEntry): void {
  const time = entry.timestamp.replace("T", " ").replace(/\.\d+Z$/, "");
  const s = sourceStyle(entry.source);
  const cmd = truncateCommand(entry.command, 120);

  if (entry.denied) {
    console.log(`${c.dim}${time}${c.reset} ${c.bgRed}${s.tag}${c.reset} ${c.red}${c.strikethrough}${cmd}${c.reset}`);
  } else if (entry.error) {
    console.log(`${c.dim}${time}${c.reset} ${s.color}${s.tag}${c.reset} ${c.red}${cmd}${c.reset}`);
  } else {
    console.log(`${c.dim}${time}${c.reset} ${s.color}${s.tag}${c.reset} ${cmd}`);
  }
}

function printRawEntry(entry: CommandLogEntry): void {
  const source = entry.source || "cli";
  const status = entry.denied ? "denied" : entry.error ? "error" : "ok";
  console.log(`${entry.timestamp}\t${source}\t${status}\t${entry.command}`);
}

function truncateCommand(cmd: string, max: number): string {
  const oneline = cmd.replace(/\n/g, " ").replace(/\s+/g, " ");
  if (oneline.length <= max) return oneline;
  return oneline.slice(0, max - 1) + "…";
}
