import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

export function generateId(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const HH = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${mm}${dd}-${HH}${min}${ss}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function loadYaml<T>(path: string): T {
  const raw = fs.readFileSync(path, "utf-8");
  return yaml.load(raw) as T;
}

export function saveYaml(path: string, data: unknown): void {
  const content = yaml.dump(data, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(path, content, "utf-8");
}

/**
 * Resolve the data directory for instance state, logs, and hooks.
 * Override with LRAIL_DATA env var (e.g. for Electron production builds
 * where cwd is read-only).
 */
export function getDataDir(): string {
  return process.env.LRAIL_DATA || ".llm-rail";
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Resolve a package-bundled directory (e.g. "learn", "builtins").
 * Resolution order:
 *   1. CLAUDE_PLUGIN_ROOT env var (plugin cache)
 *   2. Relative to CLI binary via import.meta.url (npm install / dev)
 *   3. Current working directory (fallback)
 * Returns empty string if not found anywhere.
 */
export function resolvePackageDir(dirName: string): string {
  // 1. Plugin root
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const dir = path.resolve(pluginRoot, dirName);
    if (fs.existsSync(dir)) return dir;
  }
  // 2. Relative to this file (dist/cli.js → ../dirName)
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const fromBin = path.resolve(cliDir, "..", dirName);
  if (fs.existsSync(fromBin)) return fromBin;
  // 3. CWD fallback
  const local = path.resolve(dirName);
  if (fs.existsSync(local)) return local;
  return "";
}
