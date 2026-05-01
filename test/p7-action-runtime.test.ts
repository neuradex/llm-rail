import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executeV1Actions,
  resolveShellCommand,
} from "../src/engine/actions-v1.js";
import type { V1ActionDef } from "../src/types-v1.js";

const a = (def: Partial<V1ActionDef> & { name: string }): V1ActionDef => ({
  description: def.description ?? "x",
  ...def,
});

// ── shell template resolution ──

describe("actions — resolveShellCommand template substitution", () => {
  it("inlines simple field values", () => {
    assert.equal(resolveShellCommand("echo {{name}}", { name: "alice" }), "echo alice");
  });
  it("JSON-stringifies object values", () => {
    assert.equal(
      resolveShellCommand("echo {{obj}}", { obj: { a: 1, b: 2 } }),
      `echo {"a":1,"b":2}`,
    );
  });
  it("renders null as empty string", () => {
    assert.equal(resolveShellCommand("echo '{{v}}'", { v: null }), "echo ''");
  });
  it("leaves unresolved templates as the literal {{key}}", () => {
    assert.equal(resolveShellCommand("echo {{ghost}}", { other: 1 }), "echo {{ghost}}");
  });
  it("does NOT substitute single-brace patterns", () => {
    assert.equal(resolveShellCommand("echo {x}", { x: 1 }), "echo {x}");
  });
});

// ── js return shapes ──

describe("actions — js return shape semantics", () => {
  it("object return merges into accumulated output", () => {
    const r = executeV1Actions(
      [a({ name: "x", js: "return { a: 1, b: 2 };" })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, { a: 1, b: 2 });
  });

  it("string return goes to stdout (not merged)", () => {
    const r = executeV1Actions(
      [a({ name: "x", js: "return 'hello';" })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, {});
    assert.equal(r.stdout, "hello");
  });

  it("number return goes to stdout (not merged)", () => {
    const r = executeV1Actions(
      [a({ name: "x", js: "return 42;" })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, {});
    assert.equal(r.stdout, "42");
  });

  it("array return is JSON-stringified to stdout (not merged as object)", () => {
    const r = executeV1Actions(
      [a({ name: "x", js: "return [1, 2, 3];" })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, {});
    assert.equal(r.stdout, "[1,2,3]");
  });

  it("undefined return contributes nothing (no stdout, no extracted)", () => {
    const r = executeV1Actions(
      [a({ name: "x", js: "return undefined;" })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, {});
    assert.equal(r.stdout, "");
  });

  it("null return contributes nothing", () => {
    const r = executeV1Actions(
      [a({ name: "x", js: "return null;" })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, {});
    assert.equal(r.stdout, "");
  });
});

// ── js→js merging across chain ──

describe("actions — js→js merge semantics", () => {
  it("each js return merges into running context for the next js action", () => {
    const r = executeV1Actions(
      [
        a({ name: "step1", js: "return { x: 10 };" }),
        a({ name: "step2", js: "return { y: context.x * 2 };" }),
        a({ name: "step3", js: "return { sum: context.x + context.y };" }),
      ],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, { x: 10, y: 20, sum: 30 });
  });

  it("later action overwrites earlier keys", () => {
    const r = executeV1Actions(
      [
        a({ name: "first", js: "return { v: 1 };" }),
        a({ name: "second", js: "return { v: 99 };" }),
      ],
      {},
      30_000,
    );
    assert.equal(r.extracted.v, 99);
  });
});

// ── shell→js pipe (stdout as context.stdout) ──

describe("actions — shell→js pipe via context.stdout", () => {
  it("js can read prior shell stdout from context.stdout", () => {
    const r = executeV1Actions(
      [
        a({ name: "out", shell: "echo HELLO" }),
        a({ name: "use", js: "return { upper: context.stdout };" }),
      ],
      {},
      30_000,
    );
    assert.equal(r.extracted.upper, "HELLO");
  });
});

// ── shell→shell pipe (stdout becomes stdin) ──

describe("actions — shell→shell pipe via stdin", () => {
  it("piped shell receives prior stdout as stdin", () => {
    const r = executeV1Actions(
      [
        a({ name: "src", shell: "echo lowercase" }),
        a({ name: "trans", shell: `tr a-z A-Z` }),
      ],
      {},
      30_000,
    );
    assert.equal(r.stdout, "LOWERCASE");
  });
});

// ── shell extract ──

describe("actions — shell extract", () => {
  it("extract { x: 'field' } pulls a JSON property to output", () => {
    const r = executeV1Actions(
      [a({ name: "x", shell: `echo '{"a":1,"b":2}'`, extract: { x: "a" } })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, { x: 1 });
  });

  it("extract { x: '.' } maps the whole parsed JSON to a single field", () => {
    const r = executeV1Actions(
      [a({ name: "x", shell: `echo '{"a":1,"b":2}'`, extract: { whole: "." } })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, { whole: { a: 1, b: 2 } });
  });

  it("extract on non-JSON stdout returns nothing (skips silently)", () => {
    const r = executeV1Actions(
      [a({ name: "x", shell: `echo not-json`, extract: { x: "y" } })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, {});
  });

  it("extract entry whose source key is missing is silently dropped", () => {
    const r = executeV1Actions(
      [a({ name: "x", shell: `echo '{"a":1}'`, extract: { x: "missing" } })],
      {},
      30_000,
    );
    assert.deepEqual(r.extracted, {});
  });
});

// ── shell template with object → JSON.stringify ──

describe("actions — shell template with object value", () => {
  it("substitutes object as compact JSON in shell command", () => {
    const r = executeV1Actions(
      [a({ name: "x", shell: `echo '{{obj}}' | tr -d ' '` })],
      { obj: { k: "v" } },
      30_000,
    );
    assert.equal(r.stdout, `{"k":"v"}`);
  });
});

// ── lrail.set/get/goto runtime ReferenceError ──

describe("actions — v1 purity at runtime: no lrail injection", () => {
  it("calling lrail.set throws ReferenceError caught and surfaced", () => {
    assert.throws(
      () => executeV1Actions([a({ name: "x", js: "lrail.set('k', 1); return {};" })], {}, 30_000),
      /js action 'x' failed[\s\S]*lrail/i,
    );
  });
  it("calling lrail.get throws", () => {
    assert.throws(
      () => executeV1Actions([a({ name: "x", js: "const v = lrail.get('k'); return {};" })], {}, 30_000),
      /js action 'x' failed/,
    );
  });
  it("calling lrail.goto throws", () => {
    assert.throws(
      () => executeV1Actions([a({ name: "x", js: "lrail.goto('s'); return {};" })], {}, 30_000),
      /js action 'x' failed/,
    );
  });
});

// ── js throw cleanup ──

describe("actions — js throw error message includes user message", () => {
  it("user-thrown Error surfaces with its message and is filtered of node frames", () => {
    try {
      executeV1Actions([a({ name: "x", js: "throw new Error('user-message-xyz');" })], {}, 30_000);
      assert.fail("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      assert.match(msg, /js action 'x' failed/);
      assert.match(msg, /user-message-xyz/);
      // Internal frames like "    at xxx" should be stripped
      assert.equal(/^    at /m.test(msg), false, `unexpected stack frames in: ${msg}`);
    }
  });
});

// ── timeout_ms enforcement ──

describe("actions — short timeout kills shell action", () => {
  it("a sleep that exceeds timeout throws an error", () => {
    assert.throws(
      () => executeV1Actions([a({ name: "x", shell: "sleep 5" })], {}, 200),
      /timed out|ETIMEDOUT|Command failed|signal/i,
    );
  });
});
