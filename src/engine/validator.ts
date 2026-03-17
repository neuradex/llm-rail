import type { StepDef, ValidationResult, ValidationRule } from "../types.js";

export function validateStepOutput(
  step: StepDef,
  output: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];

  // Check required fields
  for (const field of step.required_output) {
    if (!(field in output) || output[field] === undefined || output[field] === null) {
      errors.push(`Missing required field: '${field}'`);
    }
  }

  // Run validation rules
  if (step.validation) {
    for (const rule of step.validation) {
      const value = output[rule.field];
      if (value === undefined || value === null) continue; // already caught by required check
      const err = applyRule(rule, value);
      if (err) errors.push(err);
    }
  }

  return { valid: errors.length === 0, errors };
}

function applyRule(rule: ValidationRule, value: unknown): string | null {
  switch (rule.op) {
    case "exists":
      // Already handled by required check
      return null;

    case "min_length": {
      if (typeof value === "string" && value.length < Number(rule.value)) {
        return `Field '${rule.field}' must have min_length ${rule.value} (got ${value.length})`;
      }
      if (Array.isArray(value) && value.length < Number(rule.value)) {
        return `Field '${rule.field}' must have min_length ${rule.value} (got ${value.length})`;
      }
      return null;
    }

    case "min": {
      if (typeof value === "number" && value < Number(rule.value)) {
        return `Field '${rule.field}' must be >= ${rule.value} (got ${value})`;
      }
      return null;
    }

    case "max": {
      if (typeof value === "number" && value > Number(rule.value)) {
        return `Field '${rule.field}' must be <= ${rule.value} (got ${value})`;
      }
      return null;
    }

    case "type": {
      const expected = String(rule.value);
      const actual = Array.isArray(value) ? "array" : typeof value;
      if (actual !== expected) {
        return `Field '${rule.field}' must be type '${expected}' (got '${actual}')`;
      }
      return null;
    }

    default:
      return `Unknown validation op: '${rule.op}'`;
  }
}
