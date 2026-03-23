import * as fs from "node:fs";
import * as path from "node:path";
import type { EnvPolicy } from "../types.js";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

/**
 * Resolve actual secret values from process.env for the inject list.
 * Skips vars that don't exist or are empty.
 */
export function resolveSecretValues(inject: string[]): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const name of inject) {
    const value = process.env[name];
    if (value && value.length > 0) {
      secrets.set(name, value);
    }
  }
  return secrets;
}

/**
 * Parse a .env-style file and extract KEY=VALUE pairs.
 * Supports: KEY=VALUE, KEY="VALUE", KEY='VALUE', export KEY=VALUE, # comments.
 * Non-matching lines (e.g., INI sections) are skipped.
 */
export function parseEnvFile(filePath: string): Map<string, string> {
  const pairs = new Map<string, string>();
  try {
    const home = process.env.HOME || "";
    const resolved = filePath.startsWith("~/")
      ? path.resolve(home, filePath.slice(2))
      : path.resolve(filePath);

    const content = fs.readFileSync(resolved, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const key = match[1];
      let value = match[2];

      // Remove surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (value.length > 0) {
        pairs.set(key, value);
      }
    }
  } catch {
    // File doesn't exist or can't be read — skip
  }
  return pairs;
}

/**
 * Resolve all secret values from both inject (process.env) and secret_files (.env parsing).
 * This is the primary function callers should use for redaction.
 */
export function resolveAllSecrets(envPolicy: EnvPolicy): Map<string, string> {
  const secrets = new Map<string, string>();

  // 1. Explicit inject vars from process.env
  if (envPolicy.inject) {
    for (const name of envPolicy.inject) {
      const value = process.env[name];
      if (value && value.length > 0) {
        secrets.set(name, value);
      }
    }
  }

  // 2. Auto-derived from secret_files (.env parsing)
  if (envPolicy.secret_files) {
    for (const filePath of envPolicy.secret_files) {
      const pairs = parseEnvFile(filePath);
      for (const [name, value] of pairs) {
        if (!secrets.has(name)) {
          secrets.set(name, value);
        }
      }
    }
  }

  return secrets;
}

/**
 * Build subprocess env.
 * - No passthrough: inherit full process.env (+ inject)
 * - With passthrough: strict allowlist (passthrough + inject only)
 */
export function buildSanitizedEnv(
  envPolicy: EnvPolicy,
  fileSecrets?: Map<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};

  if (envPolicy.passthrough) {
    // Strict mode: only passthrough + inject
    for (const name of envPolicy.passthrough) {
      if (process.env[name] !== undefined) {
        env[name] = process.env[name]!;
      }
    }
  } else {
    // Permissive mode: inherit all env
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
  }

  // Always include inject vars
  if (envPolicy.inject) {
    for (const name of envPolicy.inject) {
      if (process.env[name] !== undefined) {
        env[name] = process.env[name]!;
      }
    }
  }

  // Inject file-derived secrets (from secret_files parsing)
  if (fileSecrets) {
    for (const [name, value] of fileSecrets) {
      if (!env[name]) {
        env[name] = value;
      }
    }
  }

  // Always forward lrail runtime vars (internal plumbing, not secrets)
  for (const key of ["CONTEXT", "CONTEXT_FILE"]) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]!;
    }
  }

  return env;
}

/**
 * Redact secret values from output string.
 * Longer values are replaced first to prevent partial match pollution.
 * Empty values are skipped (would match everything).
 */
export function redactSecrets(
  output: string,
  secretValues: Map<string, string>,
): string {
  if (secretValues.size === 0) return output;

  const sorted = [...secretValues.entries()]
    .filter(([, v]) => v.length > 0)
    .sort(([, a], [, b]) => b.length - a.length);

  let result = output;
  for (const [, value] of sorted) {
    result = result.replaceAll(value, "[REDACTED]");
  }
  return result;
}

/**
 * Check if a file path matches any secret_files pattern.
 * Handles ~ expansion.
 */
export function matchSecretFilePath(
  filePath: string,
  secretFiles: string[],
): boolean {
  const resolved = path.resolve(filePath);
  const home = process.env.HOME || "";

  for (const pattern of secretFiles) {
    const expanded = pattern.startsWith("~/")
      ? path.resolve(home, pattern.slice(2))
      : path.resolve(pattern);

    if (resolved === expanded || resolved.startsWith(expanded + path.sep)) {
      return true;
    }
  }
  return false;
}

/**
 * Scan file contents for secret values.
 * Files larger than 1MB are skipped (performance).
 */
export function checkFileForSecrets(
  filePath: string,
  secretValues: Map<string, string>,
): { blocked: boolean; reason?: string } {
  if (secretValues.size === 0) return { blocked: false };

  try {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (stat.size > MAX_FILE_SIZE) return { blocked: false };

    const content = fs.readFileSync(resolved, "utf-8");
    for (const [name, value] of secretValues) {
      if (content.includes(value)) {
        return { blocked: true, reason: `File contains secret value (${name})` };
      }
    }
  } catch {
    // File doesn't exist or can't be read — allow (Read tool will handle error)
    return { blocked: false };
  }

  return { blocked: false };
}

/**
 * Merge two EnvPolicy objects (project + workflow).
 * inject/secret_files are unioned. passthrough is unioned if either defines it.
 */
export function mergeEnvPolicies(
  project?: EnvPolicy,
  workflow?: EnvPolicy,
): EnvPolicy | undefined {
  if (!project && !workflow) return undefined;

  const merged: EnvPolicy = {};

  const inject = [...new Set([...(project?.inject || []), ...(workflow?.inject || [])])];
  if (inject.length > 0) merged.inject = inject;

  if (project?.passthrough || workflow?.passthrough) {
    merged.passthrough = [
      ...new Set([...(project?.passthrough || []), ...(workflow?.passthrough || [])]),
    ];
  }

  const secretFiles = [
    ...new Set([...(project?.secret_files || []), ...(workflow?.secret_files || [])]),
  ];
  if (secretFiles.length > 0) merged.secret_files = secretFiles;

  return Object.keys(merged).length > 0 ? merged : undefined;
}
