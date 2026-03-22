import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandLogEntry } from "../types.js";
import { readCommandLog } from "../audit/command-log.js";

export function runGlobalLog(limit?: number, follow?: boolean): void {
  const entries = readCommandLog();

  if (entries.length === 0 && !follow) {
    console.log("No command history found.");
    return;
  }

  const display = limit ? entries.slice(-limit) : entries;
  for (const entry of display) {
    printEntry(entry);
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
        printEntry(JSON.parse(line) as CommandLogEntry);
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
  console.log(`${time}  lrail ${entry.command}`);
}
