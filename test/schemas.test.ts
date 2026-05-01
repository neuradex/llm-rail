import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSchemaRegistry, collectReferences } from "../src/engine/schemas.js";
import type { SchemaDef } from "../src/types-v1.js";

describe("buildSchemaRegistry — compilation", () => {
  it("builds a valid registry from plain schemas", () => {
    const schemas: Record<string, SchemaDef> = {
      Input: {
        type: "object",
        properties: { raw: { type: "array", items: { type: "string" } } },
        required: ["raw"],
      },
    };
    const { registry, errors, cycles } = buildSchemaRegistry(schemas);
    assert.deepEqual(errors, []);
    assert.deepEqual(cycles, []);
    assert.ok(registry.has("Input"));
    assert.deepEqual(registry.listNames(), ["Input"]);
  });

  it("resolves named references across schemas", () => {
    const schemas: Record<string, SchemaDef> = {
      Record: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      Input: {
        type: "object",
        properties: { raw: { type: "array", items: "Record" } },
        required: ["raw"],
      },
    };
    const { registry, errors } = buildSchemaRegistry(schemas);
    assert.deepEqual(errors, []);
    const result = registry.validate("Input", { raw: [{ id: "a" }] });
    assert.ok(result.valid, result.errors.join(", "));
  });

  it("validates data and reports errors", () => {
    const schemas: Record<string, SchemaDef> = {
      Input: {
        type: "object",
        properties: { count: { type: "integer", minimum: 0 } },
        required: ["count"],
      },
    };
    const { registry } = buildSchemaRegistry(schemas);
    const good = registry.validate("Input", { count: 5 });
    assert.ok(good.valid);
    const bad = registry.validate("Input", { count: -1 });
    assert.ok(!bad.valid);
    assert.ok(bad.errors.length > 0);
  });
});

describe("buildSchemaRegistry — dialect enforcement", () => {
  it("rejects forbidden keywords", () => {
    const schemas: Record<string, SchemaDef> = {
      Bad: {
        type: "object",
        // @ts-expect-error — intentionally forbidden keyword
        allOf: [{ type: "object" }],
      },
    };
    const { errors } = buildSchemaRegistry(schemas);
    assert.ok(
      errors.some((e) => e.includes("allOf") && e.includes("not in the allowed subset")),
      `got: ${errors.join(" | ")}`,
    );
  });

  it("rejects $ref (we use name strings, not JSON Schema $ref)", () => {
    const schemas: Record<string, SchemaDef> = {
      Bad: {
        type: "object",
        // @ts-expect-error
        $ref: "#/definitions/X",
      },
    };
    const { errors } = buildSchemaRegistry(schemas);
    assert.ok(errors.some((e) => e.includes("$ref")));
  });

  it("rejects unknown type values", () => {
    const schemas: Record<string, SchemaDef> = {
      // @ts-expect-error — null is not in our subset
      Bad: { type: "null" },
    };
    const { errors } = buildSchemaRegistry(schemas);
    assert.ok(errors.some((e) => e.includes("type 'null'")));
  });

  it("rejects union types (type: [...])", () => {
    const schemas = {
      Bad: { type: ["string", "number"] } as unknown as SchemaDef,
    };
    const { errors } = buildSchemaRegistry(schemas);
    assert.ok(errors.some((e) => e.includes("union types")));
  });
});

describe("buildSchemaRegistry — references", () => {
  it("flags references to unknown schemas", () => {
    const schemas: Record<string, SchemaDef> = {
      Input: {
        type: "object",
        properties: { item: "MissingSchema" as unknown as SchemaDef },
      },
    };
    const { errors } = buildSchemaRegistry(schemas);
    assert.ok(
      errors.some(
        (e) => e.includes("unknown schema 'MissingSchema'") && e.includes("'Input'"),
      ),
    );
  });

  it("collects all referenced names from a schema", () => {
    const schema: SchemaDef = {
      type: "object",
      properties: {
        a: "A",
        b: { type: "array", items: "B" },
        c: { oneOf: ["C", { type: "string" }] },
      },
    } as unknown as SchemaDef;
    const refs = collectReferences(schema);
    assert.deepEqual(refs.sort(), ["A", "B", "C"]);
  });
});

describe("buildSchemaRegistry — cycles", () => {
  it("detects self-referential cycles", () => {
    const schemas: Record<string, SchemaDef> = {
      Tree: {
        type: "object",
        properties: {
          value: { type: "string" },
          children: { type: "array", items: "Tree" },
        },
      },
    };
    const { errors, cycles } = buildSchemaRegistry(schemas);
    assert.deepEqual(errors, []); // cycles are allowed
    assert.ok(cycles.length > 0);
    assert.ok(cycles.some((c) => c.includes("Tree")));
  });

  it("detects mutual cycles (A → B → A)", () => {
    const schemas: Record<string, SchemaDef> = {
      A: { type: "object", properties: { b: "B" } },
      B: { type: "object", properties: { a: "A" } },
    };
    const { cycles } = buildSchemaRegistry(schemas);
    assert.ok(cycles.length > 0);
  });
});

describe("buildSchemaRegistry — JSON Schema subset behavior", () => {
  it("honors enum", () => {
    const schemas: Record<string, SchemaDef> = {
      Color: { type: "string", enum: ["red", "green", "blue"] },
    };
    const { registry } = buildSchemaRegistry(schemas);
    assert.ok(registry.validate("Color", "red").valid);
    assert.ok(!registry.validate("Color", "yellow").valid);
  });

  it("honors oneOf as discriminated union", () => {
    const schemas: Record<string, SchemaDef> = {
      Ok: { type: "object", properties: { tag: { const: "ok" } }, required: ["tag"] },
      Err: {
        type: "object",
        properties: { tag: { const: "err" }, message: { type: "string" } },
        required: ["tag", "message"],
      },
      Result: { oneOf: ["Ok", "Err"] },
    };
    const { registry, errors } = buildSchemaRegistry(schemas);
    assert.deepEqual(errors, []);
    assert.ok(registry.validate("Result", { tag: "ok" }).valid);
    assert.ok(registry.validate("Result", { tag: "err", message: "boom" }).valid);
    assert.ok(!registry.validate("Result", { tag: "other" }).valid);
  });

  it("honors minItems / maxItems", () => {
    const schemas: Record<string, SchemaDef> = {
      Bucket: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
    };
    const { registry } = buildSchemaRegistry(schemas);
    assert.ok(registry.validate("Bucket", ["a"]).valid);
    assert.ok(!registry.validate("Bucket", []).valid);
    assert.ok(!registry.validate("Bucket", ["a", "b", "c", "d"]).valid);
  });
});
