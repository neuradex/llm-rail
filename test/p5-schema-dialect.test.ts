import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSchemaRegistry } from "../src/engine/schemas.js";
import type { SchemaDef } from "../src/types-v1.js";

function build(schemas: Record<string, SchemaDef>) {
  return buildSchemaRegistry(schemas);
}

// ── Forbidden keywords ──

describe("schemas — forbidden keywords beyond baseline", () => {
  for (const kw of ["allOf", "anyOf", "not", "if", "then", "else", "patternProperties", "dependentSchemas", "$schema"]) {
    it(`rejects '${kw}'`, () => {
      const { errors } = build({
        S: { type: "object", [kw]: kw === "if" || kw === "then" || kw === "else" ? {} : kw === "patternProperties" || kw === "dependentSchemas" ? {} : [] } as never,
      });
      assert.ok(errors.some((e) => e.includes(`keyword '${kw}'`)), errors.join("|"));
    });
  }
});

// ── type values ──

describe("schemas — type value rejection", () => {
  it("rejects type='null'", () => {
    const { errors } = build({ S: { type: "null" as never } });
    assert.ok(errors.some((e) => /type 'null' is not allowed/.test(e)));
  });
  it("rejects type='any'", () => {
    const { errors } = build({ S: { type: "any" as never } });
    assert.ok(errors.some((e) => /type 'any' is not allowed/.test(e)));
  });
  it("rejects type as array (union)", () => {
    const { errors } = build({ S: { type: ["string", "null"] as never } });
    assert.ok(errors.some((e) => /union types are not allowed/.test(e)));
  });
});

// ── additionalProperties ──

describe("schemas — additionalProperties", () => {
  it("rejects extras when additionalProperties: false", () => {
    const { registry } = build({
      S: {
        type: "object",
        properties: { x: { type: "integer" } },
        required: ["x"],
        additionalProperties: false,
      },
    });
    const r = registry.validate("S", { x: 1, y: 2 });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /additional/i.test(e) || /must NOT have/.test(e)), r.errors.join("|"));
  });
  it("accepts extras when additionalProperties: true", () => {
    const { registry } = build({
      S: { type: "object", properties: { x: { type: "integer" } }, additionalProperties: true },
    });
    assert.equal(registry.validate("S", { x: 1, y: 2 }).valid, true);
  });
  it("applies schema when additionalProperties is a subschema", () => {
    const { registry } = build({
      S: {
        type: "object",
        properties: { x: { type: "integer" } },
        additionalProperties: { type: "string" },
      },
    });
    assert.equal(registry.validate("S", { x: 1, label: "ok" }).valid, true);
    assert.equal(registry.validate("S", { x: 1, label: 99 }).valid, false);
  });
});

// ── oneOf cardinality ──

describe("schemas — oneOf cardinality", () => {
  const branches = {
    S: {
      oneOf: [
        { type: "object", properties: { kind: { const: "a" }, n: { type: "integer" } }, required: ["kind", "n"] },
        { type: "object", properties: { kind: { const: "b" }, s: { type: "string" } }, required: ["kind", "s"] },
      ],
    } as SchemaDef,
  };
  it("accepts when exactly one branch matches", () => {
    const { registry } = build(branches);
    assert.equal(registry.validate("S", { kind: "a", n: 1 }).valid, true);
    assert.equal(registry.validate("S", { kind: "b", s: "hi" }).valid, true);
  });
  it("rejects when zero branches match", () => {
    const { registry } = build(branches);
    assert.equal(registry.validate("S", { kind: "c" }).valid, false);
  });
  it("rejects when more than one branch matches (overlapping shapes)", () => {
    const { registry } = build({
      Overlap: {
        oneOf: [
          { type: "object", properties: { x: { type: "integer" } } },
          { type: "object", properties: { y: { type: "integer" } } },
        ],
      },
    });
    // {} matches both branches because both have only optional props
    assert.equal(registry.validate("Overlap", {}).valid, false);
  });
});

// ── primitive constraints ──

describe("schemas — primitive constraints", () => {
  it("integer rejects 1.5", () => {
    const { registry } = build({ S: { type: "integer" } });
    assert.equal(registry.validate("S", 1.5).valid, false);
    assert.equal(registry.validate("S", 2).valid, true);
  });
  it("number accepts 1.5 and 2", () => {
    const { registry } = build({ S: { type: "number" } });
    assert.equal(registry.validate("S", 1.5).valid, true);
    assert.equal(registry.validate("S", 2).valid, true);
  });
  it("boolean rejects 'true' string (no coercion)", () => {
    const { registry } = build({ S: { type: "boolean" } });
    assert.equal(registry.validate("S", "true").valid, false);
    assert.equal(registry.validate("S", true).valid, true);
  });
  it("string rejects integer", () => {
    const { registry } = build({ S: { type: "string" } });
    assert.equal(registry.validate("S", 42).valid, false);
  });
  it("const exact match required", () => {
    const { registry } = build({ S: { const: "v1" } });
    assert.equal(registry.validate("S", "v1").valid, true);
    assert.equal(registry.validate("S", "V1").valid, false);
  });
  it("enum value-set match required", () => {
    const { registry } = build({ S: { enum: ["a", "b", "c"] } });
    assert.equal(registry.validate("S", "b").valid, true);
    assert.equal(registry.validate("S", "z").valid, false);
  });
});

// ── range / size ──

describe("schemas — range/size constraints", () => {
  it("minLength / maxLength on string", () => {
    const { registry } = build({ S: { type: "string", minLength: 2, maxLength: 5 } });
    assert.equal(registry.validate("S", "ab").valid, true);
    assert.equal(registry.validate("S", "a").valid, false);
    assert.equal(registry.validate("S", "abcdef").valid, false);
  });
  it("minimum / maximum on number", () => {
    const { registry } = build({ S: { type: "number", minimum: 0, maximum: 100 } });
    assert.equal(registry.validate("S", 50).valid, true);
    assert.equal(registry.validate("S", -1).valid, false);
    assert.equal(registry.validate("S", 200).valid, false);
  });
  it("minItems / maxItems on array", () => {
    const { registry } = build({ S: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 3 } });
    assert.equal(registry.validate("S", [1, 2]).valid, true);
    assert.equal(registry.validate("S", []).valid, false);
    assert.equal(registry.validate("S", [1, 2, 3, 4]).valid, false);
  });
});

// ── default ──

describe("schemas — default keyword", () => {
  it("default keyword is metadata at schema level (not auto-applied during validate)", () => {
    // Ajv would apply defaults if useDefaults were enabled. We deliberately
    // don't enable it here — defaults are filled by parseV1Input (create.ts),
    // not by the schema registry. This test pins that contract: a missing
    // optional field stays missing through schema validation.
    const { registry, errors } = build({
      S: {
        type: "object",
        properties: { mode: { type: "string", default: "fast" } },
      },
    });
    assert.deepEqual(errors, []);
    const data: Record<string, unknown> = {};
    const r = registry.validate("S", data);
    assert.equal(r.valid, true);
    assert.equal(data.mode, undefined, "schema validation alone must not fill defaults");
  });
});

// ── empty schemas ──

describe("schemas — empty schemas block", () => {
  it("returns no errors for empty input but listNames is empty", () => {
    const { registry, errors, cycles } = build({});
    assert.deepEqual(errors, []);
    assert.deepEqual(cycles, []);
    assert.deepEqual(registry.listNames(), []);
    // validate against unknown name yields a clean error, not throw
    const r = registry.validate("Ghost", {});
    assert.equal(r.valid, false);
    assert.match(r.errors[0], /Unknown schema 'Ghost'/);
  });
});

// ── nested $ref via name normalization ──

describe("schemas — name reference normalization (string -> $ref)", () => {
  it("validates through a referenced child schema", () => {
    const { registry } = build({
      Inner: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      Outer: {
        type: "object",
        properties: {
          inner: "Inner",
          list: { type: "array", items: "Inner" },
        },
        required: ["inner"],
      },
    });
    assert.equal(registry.validate("Outer", { inner: { v: 1 }, list: [{ v: 2 }] }).valid, true);
    assert.equal(registry.validate("Outer", { inner: { v: "oops" } }).valid, false);
    assert.equal(registry.validate("Outer", { inner: { v: 1 }, list: [{ v: "x" }] }).valid, false);
  });

  it("flags reference to undefined name even inside additionalProperties / oneOf", () => {
    const { errors } = build({
      S: { type: "object", additionalProperties: "Ghost" as never },
    });
    assert.ok(errors.some((e) => /unknown schema 'Ghost'/.test(e)));
  });
});

// ── description metadata is allowed but inert ──

describe("schemas — description metadata is allowed", () => {
  it("description field doesn't trigger a dialect error", () => {
    const { errors } = build({
      S: { type: "string", description: "free text" },
    });
    assert.deepEqual(errors, []);
  });
});
