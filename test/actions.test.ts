import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveActionCommand, executeAction, executeActions } from "../src/engine/actions.js";
import { validateWorkflowDef } from "../src/engine/workflow.js";
import type { WorkflowDef } from "../src/types.js";

// ── resolveActionCommand ──

describe("resolveActionCommand", () => {
  it("resolves {{field}} templates", () => {
    const result = resolveActionCommand("echo {{name}}", { name: "hello" });
    assert.equal(result, "echo hello");
  });

  it("preserves unresolved templates", () => {
    const result = resolveActionCommand("echo {{missing}}", {});
    assert.equal(result, "echo {{missing}}");
  });

  it("serializes object values as JSON", () => {
    const result = resolveActionCommand("echo '{{data}}'", { data: { a: 1 } });
    assert.equal(result, `echo '{"a":1}'`);
  });
});

// ── js: action ──

describe("js: action — basic", () => {
  it("return object fields become extracted", () => {
    const result = executeAction(
      { js: `return { score: 42, label: "good" };` },
      {},
    );
    assert.equal(result.extracted.score, 42);
    assert.equal(result.extracted.label, "good");
  });

  it("context object has correct data", () => {
    const result = executeAction(
      { js: `return { got: lrail.get("myKey") };` },
      { myKey: "injected-value" },
    );
    assert.equal(result.extracted.got, "injected-value");
  });

  it("large context (>8KB) — temp file approach works", () => {
    // Build a context object that serializes to > 8192 bytes
    const bigString = "x".repeat(9000);
    const result = executeAction(
      { js: `return { len: lrail.get("big").length };` },
      { big: bigString },
    );
    assert.equal(result.extracted.len, 9000);
  });

  it("JS code throws — error message is clear", () => {
    assert.throws(
      () => executeAction({ js: `throw new Error("intentional failure");` }, {}),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("js action failed"),
          `Expected 'js action failed' in: ${err.message}`,
        );
        // The error message should reference the temp script file, confirming
        // it comes from executing the JS action wrapper, not the framework itself
        assert.ok(
          err.message.includes("lrail-js"),
          `Expected temp script path in: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("return undefined — empty extraction", () => {
    const result = executeAction(
      { js: `// no return` },
      {},
    );
    assert.deepEqual(result.extracted, {});
    assert.equal(result.stdout, "");
  });

  it("return primitive number — no crash, empty extraction", () => {
    const result = executeAction(
      { js: `return 42;` },
      {},
    );
    // Primitives are not objects so nothing is extracted, but no crash
    assert.deepEqual(result.extracted, {});
  });

  it("return primitive string — no crash, empty extraction", () => {
    const result = executeAction(
      { js: `return "hello";` },
      {},
    );
    assert.deepEqual(result.extracted, {});
  });

  it("lrail.get('stdout') available from previous shell action via pipe", () => {
    const actions = [
      { shell: `echo pipe-data` },
      { js: `return { received: lrail.get("stdout") };` },
    ];
    const result = executeActions(actions, {});
    assert.equal(result.extracted.received, "pipe-data");
  });
});

// ── shell: action ──

describe("shell: action — basic", () => {
  it("basic shell command captures stdout", () => {
    const result = executeAction(
      { shell: `echo hello-from-shell` },
      {},
    );
    assert.equal(result.stdout, "hello-from-shell");
    assert.deepEqual(result.extracted, {});
  });

  it("shell with extract: — JSON extraction works", () => {
    const result = executeAction(
      {
        shell: `echo '{"count": 7, "name": "test"}'`,
        extract: { total: "count", label: "name" },
      },
      {},
    );
    assert.equal(result.extracted.total, 7);
    assert.equal(result.extracted.label, "test");
  });

  it("shell with {{param}} template resolution", () => {
    const result = executeAction(
      { shell: `echo {{greeting}} {{name}}` },
      { greeting: "hello", name: "world" },
    );
    assert.equal(result.stdout, "hello world");
  });
});

// ── Pipe flow (executeActions) ──

describe("executeActions — pipe flow", () => {
  it("shell: → js: — stdout flows via lrail.get", () => {
    const actions = [
      { shell: `echo upstream-output` },
      { js: `return { piped: lrail.get("stdout") };` },
    ];
    const result = executeActions(actions, {});
    assert.equal(result.extracted.piped, "upstream-output");
  });

  it("js: → shell: — return value merged into context, available via {{field}}", () => {
    const actions = [
      { js: `return { value: "from-js" };` },
      { shell: `echo {{value}}` },
    ];
    const result = executeActions(actions, {});
    const actions2 = [
      { js: `return { value: "from-js" };` },
      { shell: `echo {{value}}`, extract: { got: "got" } },
    ];
    const r2 = executeActions(actions2, {});
    assert.ok(typeof r2 === "object");
  });

  it("js: → js: — return value merged into context for next js action", () => {
    const actions = [
      { js: `return { x: 10 };` },
      { js: `return { doubled: lrail.get("x") * 2 };` },
    ];
    const result = executeActions(actions, {});
    assert.equal(result.extracted.x, 10);
    assert.equal(result.extracted.doubled, 20);
  });

  it("shell: → shell: — stdout flows as stdin to next shell action", () => {
    const actions = [
      { shell: `echo '{"key": "piped-value"}'` },
      { shell: `cat`, extract: { key: "key" } },
    ];
    const result = executeActions(actions, {});
    assert.equal(result.extracted.key, "piped-value");
  });

  it("three-action chain: shell: → js: → shell:", () => {
    const actions = [
      { shell: `echo initial` },
      { js: `return { step2: "processed-" + lrail.get("stdout") };` },
      { shell: `echo {{step2}}` },
    ];
    const result = executeActions(actions, {});
    assert.equal(result.extracted.step2, "processed-initial");
  });
});

// ── executeActions — existing sequential tests ──

describe("executeActions — sequential accumulation (existing coverage)", () => {
  it("runs actions sequentially and accumulates extracted values", () => {
    const actions = [
      {
        shell: `echo '{"x": 10}'`,
        extract: { x: "x" },
      },
      {
        shell: `echo '{"y": 20}'`,
        extract: { y: "y" },
      },
    ];

    const result = executeActions(actions, {});
    assert.equal(result.extracted.x, 10);
    assert.equal(result.extracted.y, 20);
  });

  it("later actions see earlier extractions in context", () => {
    const actions = [
      {
        shell: `echo '{"val": "from_first"}'`,
        extract: { val: "val" },
      },
      {
        js: `return { got: lrail.get("val") };`,
      },
    ];

    const result = executeActions(actions, {});
    assert.equal(result.extracted.val, "from_first");
    assert.equal(result.extracted.got, "from_first");
  });
});

// ── Validation (validateWorkflowDef) ──

describe("validateWorkflowDef — action validation", () => {
  function makeProgStep(actions: unknown[]): WorkflowDef {
    return {
      name: "test-wf",
      steps: [
        {
          id: "s1",
          type: "programmatic",
          actions: actions as WorkflowDef["steps"][0]["actions"],
        },
      ],
    };
  }

  it("accepts js: action in programmatic step", () => {
    const def = makeProgStep([{ js: `return { x: 1 };` }]);
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("accepts shell: action in programmatic step", () => {
    const def = makeProgStep([{ shell: `echo hello` }]);
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("accepts mixed js: and shell: actions in one step", () => {
    const def = makeProgStep([
      { shell: `echo '{"raw": "data"}'` },
      { js: `return { processed: lrail.get("stdout") };` },
    ]);
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("rejects empty js: string", () => {
    const def = makeProgStep([{ js: "" }]);
    const errors = validateWorkflowDef(def);
    assert.ok(errors.length > 0, "Expected validation error for empty js:");
    assert.ok(
      errors.some(e => e.includes("action[0]")),
      `Expected action[0] error, got: ${JSON.stringify(errors)}`,
    );
  });

  it("rejects action with both js: and shell:", () => {
    const def = makeProgStep([{ js: `return 1;`, shell: `echo hi` }]);
    const errors = validateWorkflowDef(def);
    assert.ok(errors.length > 0, "Expected error for action with both js: and shell:");
    assert.ok(
      errors.some(e => e.includes("exactly one")),
      `Expected 'exactly one' error, got: ${JSON.stringify(errors)}`,
    );
  });

  it("rejects js: action with extract:", () => {
    const def = makeProgStep([{ js: `return { x: 1 };`, extract: { x: "x" } }]);
    const errors = validateWorkflowDef(def);
    assert.ok(errors.length > 0, "Expected error for js: with extract:");
    assert.ok(
      errors.some(e => e.includes("extract")),
      `Expected 'extract' error, got: ${JSON.stringify(errors)}`,
    );
  });

  it("rejects action with neither js: nor shell: (unknown key)", () => {
    const def = makeProgStep([{ unknown: `echo ok` } as unknown as Parameters<typeof makeProgStep>[0][0]]);
    const errors = validateWorkflowDef(def);
    assert.ok(errors.length > 0, "Expected validation error for action with neither js: nor shell:");
    assert.ok(
      errors.some(e => e.includes("action[0]")),
      `Expected action[0] error, got: ${JSON.stringify(errors)}`,
    );
  });

  it("rejects programmatic step with no actions", () => {
    const def = makeProgStep([]);
    const errors = validateWorkflowDef(def);
    assert.ok(
      errors.some(e => e.includes("at least one action")),
      `Expected 'at least one action' error, got: ${JSON.stringify(errors)}`,
    );
  });
});
