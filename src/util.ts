import * as fs from "node:fs";
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

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
