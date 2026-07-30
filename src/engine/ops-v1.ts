import { execFileSync } from "node:child_process";
import type {
  AssertionOp,
  AssertionRule,
} from "../types.js";

/**
 * `output` is the **whole step output** the rule was evaluated against — not just
 * the field. Only `script` uses it (see below); every other op is a pure function of
 * its own field and ignores the argument.
 */
type OpHandler = (
  value: unknown,
  expected: unknown,
  field: string,
  output?: Record<string, unknown>,
  env?: Record<string, string>,
) => string | null;

const opHandlers: Record<AssertionOp, OpHandler> = {
  exists: () => null,

  not_empty: (value, _expected, field) => {
    if (value === "" || value === null || value === undefined) {
      return `Field '${field}' must not be empty`;
    }
    if (Array.isArray(value) && value.length === 0) {
      return `Field '${field}' must not be empty`;
    }
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) {
      return `Field '${field}' must not be empty`;
    }
    return null;
  },

  type: (value, expected, field) => {
    const exp = String(expected);
    const actual = Array.isArray(value) ? "array" : typeof value;
    if (actual !== exp) {
      return `Field '${field}' must be type '${exp}' (got '${actual}')`;
    }
    return null;
  },

  min_length: (value, expected, field) => {
    const min = Number(expected);
    if (typeof value === "string" && value.length < min) {
      return `Field '${field}' must have min_length ${min} (got ${value.length})`;
    }
    if (Array.isArray(value) && value.length < min) {
      return `Field '${field}' must have min_length ${min} (got ${value.length})`;
    }
    return null;
  },

  max_length: (value, expected, field) => {
    const max = Number(expected);
    if (typeof value === "string" && value.length > max) {
      return `Field '${field}' must have max_length ${max} (got ${value.length})`;
    }
    if (Array.isArray(value) && value.length > max) {
      return `Field '${field}' must have max_length ${max} (got ${value.length})`;
    }
    return null;
  },

  length: (value, expected, field) => {
    const len = Number(expected);
    if (typeof value === "string" && value.length !== len) {
      return `Field '${field}' must have length ${len} (got ${value.length})`;
    }
    if (Array.isArray(value) && value.length !== len) {
      return `Field '${field}' must have length ${len} (got ${value.length})`;
    }
    return null;
  },

  min: (value, expected, field) => {
    if (typeof value === "number" && value < Number(expected)) {
      return `Field '${field}' must be >= ${expected} (got ${value})`;
    }
    return null;
  },

  max: (value, expected, field) => {
    if (typeof value === "number" && value > Number(expected)) {
      return `Field '${field}' must be <= ${expected} (got ${value})`;
    }
    return null;
  },

  between: (value, expected, field) => {
    if (typeof value !== "number" || !Array.isArray(expected) || expected.length !== 2) return null;
    const [min, max] = expected as [number, number];
    if (value < min || value > max) {
      return `Field '${field}' must be between ${min} and ${max} (got ${value})`;
    }
    return null;
  },

  eq: (value, expected, field) => {
    if (value !== expected) {
      return `Field '${field}' must equal ${JSON.stringify(expected)} (got ${JSON.stringify(value)})`;
    }
    return null;
  },

  neq: (value, expected, field) => {
    if (value === expected) {
      return `Field '${field}' must not equal ${JSON.stringify(expected)}`;
    }
    return null;
  },

  gt: (value, expected, field) => {
    if (typeof value === "number" && value <= Number(expected)) {
      return `Field '${field}' must be > ${expected} (got ${value})`;
    }
    return null;
  },

  gte: (value, expected, field) => {
    if (typeof value === "number" && value < Number(expected)) {
      return `Field '${field}' must be >= ${expected} (got ${value})`;
    }
    return null;
  },

  lt: (value, expected, field) => {
    if (typeof value === "number" && value >= Number(expected)) {
      return `Field '${field}' must be < ${expected} (got ${value})`;
    }
    return null;
  },

  lte: (value, expected, field) => {
    if (typeof value === "number" && value > Number(expected)) {
      return `Field '${field}' must be <= ${expected} (got ${value})`;
    }
    return null;
  },

  contains: (value, expected, field) => {
    if (typeof value === "string" && !value.includes(String(expected))) {
      return `Field '${field}' must contain '${expected}'`;
    }
    if (Array.isArray(value) && !value.includes(expected)) {
      return `Field '${field}' must contain ${JSON.stringify(expected)}`;
    }
    return null;
  },

  not_contains: (value, expected, field) => {
    if (typeof value === "string" && value.includes(String(expected))) {
      return `Field '${field}' must not contain '${expected}'`;
    }
    if (Array.isArray(value) && value.includes(expected)) {
      return `Field '${field}' must not contain ${JSON.stringify(expected)}`;
    }
    return null;
  },

  matches: (value, expected, field) => {
    if (typeof value !== "string") return null;
    try {
      const re = new RegExp(String(expected));
      if (!re.test(value)) {
        return `Field '${field}' must match pattern '${expected}' (got '${value}')`;
      }
    } catch {
      return `Field '${field}': invalid regex pattern '${expected}'`;
    }
    return null;
  },

  one_of: (value, expected, field) => {
    if (!Array.isArray(expected)) return null;
    if (!expected.includes(value)) {
      return `Field '${field}' must be one of [${expected.join(", ")}] (got ${JSON.stringify(value)})`;
    }
    return null;
  },

  each_has: (value, expected, field) => {
    if (!Array.isArray(value)) return null;
    const key = String(expected);
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item !== "object" || item === null || !(key in item)) {
        return `Field '${field}[${i}]' must have key '${key}'`;
      }
    }
    return null;
  },

  /**
   * Shell assertion. Exit 0 passes; any non-zero fails with stderr as the message.
   *
   * Two env vars are injected:
   *
   *   FIELD_VALUE  the rule's own field, JSON-encoded
   *   STEP_OUTPUT  the **whole step output**, JSON-encoded
   *
   * `STEP_OUTPUT` exists because cross-field assertions are common and were
   * previously impossible: a rule declared on one field could not see its siblings.
   * Authors worked around it by reading an env var that did not exist, which is worse
   * than failing — `JSON.parse(process.env.CONTEXT || "{}")` yields `{}`, the checks
   * iterate nothing, and the assertion **passes silently**. Four assertions in a
   * downstream repo were dead that way for weeks; nothing in the logs showed it,
   * because a passing assertion says nothing. One of them was the only guard on edge
   * payloads, so malformed edges reached the API and a foreign-key violation there
   * killed whole workflow runs.
   *
   * Deliberately **not** aliased to `CONTEXT`, even though that is the name the dead
   * scripts reach for. Reviving them silently is the same class of mistake as letting
   * them die silently: one of those assertions also depends on a per-rule `env:` map
   * that this engine drops on the floor, so switching it on by stealth would make it
   * fail every submission instead of passing every submission. Opting in by writing
   * `STEP_OUTPUT` forces an author to look at the assertion once.
   */
  script: (value, expected, field, output, env) => {
    const cmd = String(expected);
    // Rule-declared env first, so a typo in `env:` can never shadow the two names the
    // engine guarantees (assigned last, below).
    const scriptEnv: Record<string, string | undefined> = { ...process.env, ...(env ?? {}) };
    // `CONTEXT` must be *absent*, not merely unset by us. It can arrive two other ways —
    // inherited from the parent process, or declared in a rule's `env:` — and either one
    // silently revives a legacy assertion that has been passing vacuously. Deleting it
    // here is what makes the contract enforceable rather than aspirational.
    delete scriptEnv.CONTEXT;
    try {
      execFileSync("sh", ["-c", cmd], {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...scriptEnv,
          FIELD_VALUE: JSON.stringify(value),
          STEP_OUTPUT: JSON.stringify(output ?? {}),
        },
      });
    } catch (e: unknown) {
      const err = e as { stderr?: string; status?: number };
      const exitCode = err.status || 1;
      const msg = err.stderr?.trim() || `script exited with code ${exitCode}`;
      return `Field '${field}': script assertion failed — ${msg}`;
    }
    return null;
  },

  verify_source: (value, expected, field) => {
    if (!Array.isArray(value) || typeof expected !== "object" || expected === null) return null;
    const { url_field, field_snippets } = expected as {
      url_field: string;
      field_snippets: Record<string, string>;
    };
    if (!url_field || !field_snippets || typeof field_snippets !== "object") {
      return `Field '${field}': verify_source requires url_field and field_snippets`;
    }

    for (let i = 0; i < value.length; i++) {
      const item = value[i] as Record<string, unknown>;
      if (typeof item !== "object" || item === null) continue;

      const url = item[url_field];
      if (typeof url !== "string" || !url) {
        return `Field '${field}[${i}]' missing '${url_field}' for source verification`;
      }

      const snippetsToVerify: string[] = [];
      for (const [dataField, snippetField] of Object.entries(field_snippets)) {
        const dataVal = item[dataField];
        if (dataVal === null || dataVal === undefined) continue;

        const snippet = item[snippetField];
        if (typeof snippet !== "string" || !snippet) {
          return `Field '${field}[${i}]' missing '${snippetField}' for source verification of '${dataField}'`;
        }

        const valStr = String(dataVal);
        if (!snippet.includes(valStr)) {
          return `Field '${field}[${i}]': ${snippetField} does not contain ${dataField}=${valStr} — snippet must include the actual data value`;
        }

        snippetsToVerify.push(snippet);
      }

      if (snippetsToVerify.length > 0) {
        let body: string;
        try {
          body = execFileSync("curl", ["-sL", "--max-time", "10", url], {
            encoding: "utf-8",
            timeout: 15_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch {
          return `Field '${field}[${i}]': failed to fetch ${url} for source verification`;
        }

        for (const snippet of snippetsToVerify) {
          if (!body.includes(snippet)) {
            return `Field '${field}[${i}]': snippet "${snippet.slice(0, 60)}..." not found at ${url} — data may be fabricated`;
          }
        }
      }
    }
    return null;
  },
};

/**
 * Apply a single AssertionRule to a value. Returns null on success or
 * a human-readable error message on failure. Used by router-v1 (when
 * evaluating case conditions) and by runner-v1 (running residual
 * `validation:` / `assertions:` blocks on agentic / programmatic
 * outputs).
 */
export function applyRule(
  rule: AssertionRule,
  value: unknown,
  /**
   * The whole step output the rule is being evaluated against. Optional so existing
   * callers keep compiling; without it a `script` assertion sees `{}` in
   * `STEP_OUTPUT` and can only check its own `FIELD_VALUE`.
   */
  output?: Record<string, unknown>,
  /**
   * `rule.env` with any `{step.field}` references already resolved. The caller owns
   * resolution because only it has the instance state.
   */
  env?: Record<string, string>,
): string | null {
  const handler = opHandlers[rule.op];
  if (!handler) {
    return `Unknown assertion op: '${rule.op}'`;
  }
  const err = handler(value, rule.value, rule.field, output, env);
  if (err && rule.message) return `Field '${rule.field}': ${rule.message}`;
  return err;
}
