import { execFileSync } from "node:child_process";
import type { StepDef, AssertionRule, AssertionOp, ValidationResult } from "../types.js";

type OpHandler = (value: unknown, expected: unknown, field: string) => string | null;

const opHandlers: Record<AssertionOp, OpHandler> = {
  exists: (_value, _expected, _field) => null, // handled by required check

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

      // Collect snippets to verify, checking each contains its data value
      const snippetsToVerify: string[] = [];
      for (const [dataField, snippetField] of Object.entries(field_snippets)) {
        const dataVal = item[dataField];
        if (dataVal === null || dataVal === undefined) continue; // skip null fields

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

      // Fetch the URL once and check all snippets exist on the page
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

function applyRule(rule: AssertionRule, value: unknown): string | null {
  const handler = opHandlers[rule.op];
  if (!handler) {
    return `Unknown assertion op: '${rule.op}'`;
  }
  const err = handler(value, rule.value, rule.field);
  if (err && rule.message) return `Field '${rule.field}': ${rule.message}`;
  return err;
}

export function validateStepOutput(
  step: StepDef,
  output: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];

  for (const field of step.required_output || []) {
    if (!(field in output) || output[field] === undefined || output[field] === null) {
      errors.push(`Missing required field: '${field}'`);
    }
  }

  if (step.validation) {
    for (const rule of step.validation) {
      const value = output[rule.field];
      if (value === undefined || value === null) continue;
      const err = applyRule(rule, value);
      if (err) errors.push(err);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function runAssertions(
  rules: AssertionRule[],
  data: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];

  for (const rule of rules) {
    const value = data[rule.field];
    if (value === undefined || value === null) {
      if (rule.op === "exists" || rule.op === "not_empty") {
        const msg = rule.message
          ? `Field '${rule.field}': ${rule.message}`
          : `Field '${rule.field}' ${rule.op === "exists" ? "must exist" : "must not be empty"}`;
        errors.push(msg);
      }
      continue;
    }
    const err = applyRule(rule, value);
    if (err) errors.push(err);
  }

  return { valid: errors.length === 0, errors };
}
