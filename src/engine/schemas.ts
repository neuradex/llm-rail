import Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { SchemaDef, SchemaOrRef } from "../types-v1.js";

// ── Allowed keywords (JSON Schema 2020-12 minimal subset, RFC §4.3) ──

const ALLOWED_SCHEMA_KEYWORDS = new Set<string>([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "oneOf",
  "default",
  "description",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
]);

const ALLOWED_TYPES = new Set<string>([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
]);

// ── Public API ──

/**
 * Result of building a schema registry from a `schemas:` block.
 *
 * - `errors` holds static problems (unknown references, forbidden keywords).
 *   If non-empty, `validate` still works for schemas that could be compiled
 *   but some names may be missing.
 * - `cycles` lists schema cycles detected via DFS. Cycles are *allowed*
 *   (they express recursive data structures) but the caller may want to
 *   surface them for awareness.
 */
export interface SchemaRegistryResult {
  registry: SchemaRegistry;
  errors: string[];
  cycles: string[][];
}

export interface SchemaRegistry {
  /** Validate `data` against the named schema. */
  validate(schemaName: string, data: unknown): { valid: boolean; errors: string[] };
  /** Return the raw (un-normalized) definition for a name, or undefined. */
  getDefinition(name: string): SchemaDef | undefined;
  /** List all schema names. */
  listNames(): string[];
  /** True if a schema with this name was successfully registered with Ajv. */
  has(name: string): boolean;
}

/**
 * Build a SchemaRegistry from a `schemas:` block.
 *
 * Performs in order:
 *   1. Dialect check — reject forbidden keywords / invalid `type` values.
 *   2. Reference resolution — ensure every name reference points to a
 *      schema that exists.
 *   3. Cycle detection — DFS to find reference cycles (reported, not blocked).
 *   4. Normalization — rewrite `"<Name>"` references as `{ $ref: "<Name>" }`
 *      so Ajv can resolve them.
 *   5. Compilation — register each schema with Ajv under its name as `$id`.
 *
 * Schemas that failed dialect/reference checks are skipped during compilation
 * so that a single bad schema doesn't poison the whole registry.
 */
export function buildSchemaRegistry(
  schemas: Record<string, SchemaDef>,
): SchemaRegistryResult {
  const errors: string[] = [];
  const names = Object.keys(schemas);
  const nameSet = new Set(names);

  // 1. Dialect check for each schema.
  for (const name of names) {
    checkDialect(name, schemas[name], errors);
  }

  // 2. Reference resolution: find all referenced names, verify they exist.
  for (const name of names) {
    const refs = collectReferences(schemas[name]);
    for (const ref of refs) {
      if (!nameSet.has(ref)) {
        errors.push(
          `Schema '${name}' references unknown schema '${ref}'`,
        );
      }
    }
  }

  // 3. Cycle detection (DFS). Reported, not blocked.
  const cycles = detectCycles(schemas, nameSet);

  // 4+5. Normalize and register with Ajv, skipping schemas that hit dialect
  // errors (to avoid compile-time throws from Ajv).
  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    allowUnionTypes: false,
  });

  const registered = new Set<string>();
  const validators = new Map<string, ValidateFunction>();

  // Pre-compile: add all schemas under their names as $id. We normalize
  // references inline so Ajv can find them during compilation.
  const resolver = (n: string) => nameSet.has(n);

  for (const name of names) {
    const normalized = normalize(schemas[name], resolver) as Record<string, unknown>;
    normalized.$id = name;
    try {
      ajv.addSchema(normalized, name);
      registered.add(name);
    } catch (err) {
      errors.push(
        `Schema '${name}' failed to register with Ajv: ${(err as Error).message}`,
      );
    }
  }

  // Compile each validator (getSchema triggers resolution of $ref across
  // all registered schemas).
  for (const name of registered) {
    try {
      const validator = ajv.getSchema(name);
      if (validator) {
        validators.set(name, validator);
      }
    } catch (err) {
      errors.push(
        `Schema '${name}' failed to compile: ${(err as Error).message}`,
      );
    }
  }

  const registry: SchemaRegistry = {
    validate(schemaName, data) {
      const validator = validators.get(schemaName);
      if (!validator) {
        return {
          valid: false,
          errors: [`Unknown schema '${schemaName}'`],
        };
      }
      const valid = validator(data) as boolean;
      if (valid) return { valid: true, errors: [] };
      return {
        valid: false,
        errors: (validator.errors ?? []).map(formatAjvError),
      };
    },
    getDefinition(name) {
      return schemas[name];
    },
    listNames() {
      return [...names];
    },
    has(name) {
      return validators.has(name);
    },
  };

  return { registry, errors, cycles };
}

/**
 * Collect every named reference that appears anywhere in a schema.
 * A reference is a *string* value in a position where a schema is expected.
 */
export function collectReferences(schema: SchemaOrRef): string[] {
  const found = new Set<string>();
  collectRefs(schema, found);
  return [...found];
}

// ── Internal helpers ──

function collectRefs(schema: SchemaOrRef, found: Set<string>): void {
  if (typeof schema === "string") {
    found.add(schema);
    return;
  }
  if (!schema || typeof schema !== "object") return;

  if (schema.items !== undefined) {
    collectRefs(schema.items, found);
  }
  if (schema.properties) {
    for (const v of Object.values(schema.properties)) {
      collectRefs(v, found);
    }
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean"
  ) {
    collectRefs(schema.additionalProperties, found);
  }
  if (schema.oneOf) {
    for (const s of schema.oneOf) collectRefs(s, found);
  }
}

function checkDialect(name: string, schema: SchemaDef, errors: string[]): void {
  walkSchemaNodes(schema, (node, pathLabel) => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;

    for (const key of Object.keys(node)) {
      if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) {
        errors.push(
          `Schema '${name}'${pathLabel}: keyword '${key}' is not in the allowed subset`,
        );
      }
    }

    const typed = node as { type?: unknown };
    if (typeof typed.type === "string" && !ALLOWED_TYPES.has(typed.type)) {
      errors.push(
        `Schema '${name}'${pathLabel}: type '${typed.type}' is not allowed`,
      );
    }
    if (Array.isArray(typed.type)) {
      errors.push(
        `Schema '${name}'${pathLabel}: union types are not allowed (got array)`,
      );
    }
  });
}

/**
 * Visit every subschema node with a callback. Treats string schema
 * references as leaves (not visited — they point elsewhere).
 */
function walkSchemaNodes(
  schema: SchemaOrRef,
  visit: (node: Record<string, unknown>, path: string) => void,
  pathLabel = "",
): void {
  if (typeof schema === "string") return;
  if (!schema || typeof schema !== "object") return;

  visit(schema as unknown as Record<string, unknown>, pathLabel);

  if (schema.items !== undefined) {
    walkSchemaNodes(schema.items, visit, `${pathLabel}.items`);
  }
  if (schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) {
      walkSchemaNodes(v, visit, `${pathLabel}.properties.${k}`);
    }
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean"
  ) {
    walkSchemaNodes(schema.additionalProperties, visit, `${pathLabel}.additionalProperties`);
  }
  if (schema.oneOf) {
    schema.oneOf.forEach((s, i) => {
      walkSchemaNodes(s, visit, `${pathLabel}.oneOf[${i}]`);
    });
  }
}

/**
 * Detect reference cycles via DFS. Returns a list of cycle paths (each cycle
 * is represented by the sequence of schema names that form the loop).
 */
function detectCycles(
  schemas: Record<string, SchemaDef>,
  nameSet: Set<string>,
): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const dfs = (name: string): void => {
    if (onStack.has(name)) {
      const idx = stack.indexOf(name);
      cycles.push(stack.slice(idx).concat(name));
      return;
    }
    if (visited.has(name)) return;
    visited.add(name);
    onStack.add(name);
    stack.push(name);

    const refs = collectReferences(schemas[name]);
    for (const r of refs) {
      if (nameSet.has(r)) dfs(r);
    }

    stack.pop();
    onStack.delete(name);
  };

  for (const name of Object.keys(schemas)) {
    dfs(name);
  }

  return cycles;
}

/**
 * Rewrite string references as `{ $ref: "<name>" }` so Ajv can resolve.
 * Leaves inline subschemas untouched (beyond recursing into them).
 */
function normalize(
  schema: SchemaOrRef,
  resolver: (name: string) => boolean,
): unknown {
  if (typeof schema === "string") {
    if (!resolver(schema)) {
      // Unknown reference; emit an impossible schema so validation fails
      // predictably rather than throwing at compile time.
      return { not: {} };
    }
    return { $ref: schema };
  }
  if (!schema || typeof schema !== "object") return schema;

  const s = schema as SchemaDef;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(s)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) continue; // dialect filter
    const value = (s as Record<string, unknown>)[key];

    if (key === "items") {
      out.items = normalize(value as SchemaOrRef, resolver);
    } else if (key === "properties") {
      const props = value as Record<string, SchemaOrRef>;
      out.properties = Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, normalize(v, resolver)]),
      );
    } else if (key === "additionalProperties" && typeof value !== "boolean") {
      out.additionalProperties = normalize(value as SchemaOrRef, resolver);
    } else if (key === "oneOf") {
      out.oneOf = (value as SchemaOrRef[]).map((x) => normalize(x, resolver));
    } else {
      out[key] = value;
    }
  }

  return out;
}

function formatAjvError(err: ErrorObject): string {
  const path = err.instancePath || "(root)";
  return `${path} ${err.message ?? "failed validation"}`;
}
