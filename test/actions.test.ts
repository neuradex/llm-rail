import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveActionCommand, executeAction, executeActions } from "../src/engine/actions.js";

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

describe("executeAction", () => {
  it("runs a shell command and captures stdout", () => {
    const result = executeAction({ run: "echo hello" }, {});
    assert.equal(result.stdout, "hello");
    assert.deepEqual(result.extracted, {});
  });

  it("passes context JSON on stdin", () => {
    // jq reads from stdin — use cat as simpler fallback
    const result = executeAction(
      { run: "cat" },
      { key: "value" },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.key, "value");
  });

  it("extracts values from stdout JSON", () => {
    const result = executeAction(
      {
        run: `echo '{"count": 42, "name": "test"}'`,
        extract: { total: "count", label: "name" },
      },
      {},
    );
    assert.equal(result.extracted.total, 42);
    assert.equal(result.extracted.label, "test");
  });

  it("throws on non-zero exit", () => {
    assert.throws(() => {
      executeAction({ run: "exit 1" }, {});
    });
  });
});

describe("executeActions", () => {
  it("runs actions sequentially and accumulates extracted values", () => {
    const actions = [
      {
        run: `echo '{"x": 10}'`,
        extract: { x: "x" },
      },
      {
        // Second action can reference x from context (via stdin)
        run: `echo '{"y": 20}'`,
        extract: { y: "y" },
      },
    ];

    const result = executeActions(actions, {});
    assert.equal(result.x, 10);
    assert.equal(result.y, 20);
  });

  it("later actions see earlier extractions in context", () => {
    const actions = [
      {
        run: `echo '{"val": "from_first"}'`,
        extract: { val: "val" },
      },
      {
        // Read val from stdin context (set by first action's extract)
        run: `node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify({got:d.val}))"`,
        extract: { got: "got" },
      },
    ];

    const result = executeActions(actions, {});
    assert.equal(result.val, "from_first");
    assert.equal(result.got, "from_first");
  });
});
