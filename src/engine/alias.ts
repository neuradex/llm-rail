import * as fs from "node:fs";
import * as path from "node:path";
import { getDataDir } from "../util.js";

const ADJECTIVES = [
  "bold", "calm", "cool", "dark", "deep", "dry", "fair", "fast", "firm", "flat",
  "free", "full", "gold", "gray", "keen", "kind", "lean", "live", "long", "mild",
  "neat", "open", "pale", "pure", "rare", "raw", "red", "rich", "safe", "sharp",
  "slim", "soft", "tall", "thin", "true", "vast", "warm", "wide", "wild", "wise",
  "blue", "bright", "clear", "crisp", "fresh", "green", "prime", "quick", "still", "swift",
];

const NOUNS = [
  "arc", "ash", "bay", "bow", "cap", "cog", "dam", "dew", "dot", "elm",
  "fig", "fin", "fox", "gem", "hub", "ink", "ivy", "jar", "jet", "key",
  "kit", "lap", "log", "map", "net", "oak", "orb", "owl", "pad", "pin",
  "ray", "rib", "rod", "rue", "rye", "sky", "sun", "tap", "tip", "urn",
  "vow", "wax", "web", "yew", "zen", "axe", "bee", "elm", "ore", "ram",
];

export function generateAlias(existingAliases: Set<string>): string {
  const maxAttempts = 200;
  for (let i = 0; i < maxAttempts; i++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const alias = `${adj}-${noun}`;
    if (!existingAliases.has(alias)) return alias;
  }
  // Fallback: append random number
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}-${Math.floor(Math.random() * 1000)}`;
}

export function collectExistingAliases(stateDir: string): Set<string> {
  const aliases = new Set<string>();
  if (!fs.existsSync(stateDir)) return aliases;

  for (const workflowDir of fs.readdirSync(stateDir)) {
    const wfPath = path.resolve(stateDir, workflowDir);
    if (!fs.statSync(wfPath).isDirectory()) continue;

    for (const instanceDir of fs.readdirSync(wfPath)) {
      const aliasFile = path.resolve(wfPath, instanceDir, "alias");
      if (fs.existsSync(aliasFile)) {
        aliases.add(fs.readFileSync(aliasFile, "utf-8").trim());
      }
    }
  }
  return aliases;
}

/**
 * Resolve a string that is either an instance id or an alias to a
 * canonical id. Throws if neither matches an instance under the data
 * directory. Format-agnostic — works for v1 instances (the only
 * supported runtime in 1.0.0).
 */
export function resolveInstanceId(idOrAlias: string): string {
  const baseDir = path.resolve(getDataDir());

  if (fs.existsSync(baseDir)) {
    for (const workflowDir of fs.readdirSync(baseDir)) {
      const wfPath = path.resolve(baseDir, workflowDir);
      if (!fs.statSync(wfPath).isDirectory()) continue;
      if (fs.existsSync(path.resolve(wfPath, idOrAlias, "state.yaml"))) {
        return idOrAlias;
      }
    }
  }

  const resolved = resolveAlias(baseDir, idOrAlias);
  if (resolved) return resolved;

  throw new Error(`Instance not found: ${idOrAlias}`);
}

/** Resolve an alias to an instance ID. Returns null if not found. */
export function resolveAlias(stateDir: string, alias: string): string | null {
  if (!fs.existsSync(stateDir)) return null;

  for (const workflowDir of fs.readdirSync(stateDir)) {
    const wfPath = path.resolve(stateDir, workflowDir);
    if (!fs.statSync(wfPath).isDirectory()) continue;

    for (const instanceDir of fs.readdirSync(wfPath)) {
      const aliasFile = path.resolve(wfPath, instanceDir, "alias");
      if (fs.existsSync(aliasFile)) {
        const stored = fs.readFileSync(aliasFile, "utf-8").trim();
        if (stored === alias) return instanceDir;
      }
    }
  }
  return null;
}
