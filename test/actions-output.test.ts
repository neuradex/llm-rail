import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeAction, executeActions } from "../src/engine/actions.js";
import { LrailGoto } from "../src/types.js";

// ── Change 1: JS action string return → raw stdout (no JSON.stringify) ──

describe("js action — string return outputs raw (no JSON wrapping)", () => {
  it("returns raw string in stdout (no quotes, no JSON wrapping)", () => {
    const result = executeAction(
      { js: `return "hello world";` },
      {},
    );
    // The wrapper writes strings raw via process.stdout.write
    assert.equal(result.stdout, "hello world");
    // Strings are not JSON-parseable as objects, so extracted stays empty
    assert.deepEqual(result.extracted, {});
  });

  it("returns multiline string raw", () => {
    const result = executeAction(
      { js: 'return "line1\\nline2\\nline3";' },
      {},
    );
    assert.equal(result.stdout, "line1\nline2\nline3");
  });

  it("returns string containing JSON-like content raw (not double-encoded)", () => {
    const result = executeAction(
      { js: 'return JSON.stringify({ key: "value" });' },
      {},
    );
    // The return value is a string, so it's written raw.
    // Then the extraction logic parses it as JSON and finds an object.
    assert.equal(result.stdout, '{"key":"value"}');
    // Since it parses as a JSON object, it gets extracted
    assert.equal(result.extracted.key, "value");
  });
});

// ── Change 1: JS action object return → still JSON.stringify in stdout ──

describe("js action — object return still JSON-stringified in stdout", () => {
  it("object return is JSON-stringified in stdout", () => {
    const result = executeAction(
      { js: `return { score: 42, label: "good" };` },
      {},
    );
    assert.equal(result.stdout, '{"score":42,"label":"good"}');
    assert.equal(result.extracted.score, 42);
    assert.equal(result.extracted.label, "good");
  });

  it("array return is JSON-stringified in stdout", () => {
    const result = executeAction(
      { js: `return [1, 2, 3];` },
      {},
    );
    assert.equal(result.stdout, "[1,2,3]");
    // Arrays are not plain objects, so nothing extracted
    assert.deepEqual(result.extracted, {});
  });

  it("number return is written as string in stdout", () => {
    const result = executeAction(
      { js: `return 42;` },
      {},
    );
    assert.equal(result.stdout, "42");
    // Not an object, so empty extracted
    assert.deepEqual(result.extracted, {});
  });
});

// ── Change 1: undefined/null returns handled gracefully ──

describe("js action — undefined/null return", () => {
  it("undefined return — empty stdout, empty extracted", () => {
    const result = executeAction(
      { js: `// no return` },
      {},
    );
    assert.equal(result.stdout, "");
    assert.deepEqual(result.extracted, {});
  });

  it("null return — empty stdout, empty extracted", () => {
    const result = executeAction(
      { js: `return null;` },
      {},
    );
    // null is filtered by the `if (__result !== undefined && __result !== null)` guard
    assert.equal(result.stdout, "");
    assert.deepEqual(result.extracted, {});
  });
});

// ── Change 1: executeActions returns stdout ──

describe("executeActions — stdout field in result", () => {
  it("returns stdout from the last action (js string return)", () => {
    const result = executeActions(
      [{ js: `return "final output";` }],
      {},
    );
    assert.equal(result.stdout, "final output");
    assert.deepEqual(result.extracted, {});
  });

  it("returns stdout from the last action (js object return)", () => {
    const result = executeActions(
      [{ js: `return { key: "value" };` }],
      {},
    );
    assert.equal(result.stdout, '{"key":"value"}');
    assert.equal(result.extracted.key, "value");
  });

  it("returns stdout from the last action in a chain", () => {
    const result = executeActions(
      [
        { js: `return "first";` },
        { js: `return "second";` },
      ],
      {},
    );
    // stdout should be from the last action
    assert.equal(result.stdout, "second");
  });

  it("returns stdout from the last shell action", () => {
    const result = executeActions(
      [{ shell: `echo "shell output"` }],
      {},
    );
    assert.equal(result.stdout, "shell output");
  });

  it("stdout is undefined when no actions provided", () => {
    const result = executeActions([], {});
    assert.equal(result.stdout, undefined);
    assert.deepEqual(result.extracted, {});
  });

  it("mixed chain: stdout is from the last action", () => {
    const result = executeActions(
      [
        { shell: `echo "from shell"` },
        { js: `return "from js";` },
      ],
      {},
    );
    assert.equal(result.stdout, "from js");
  });
});

// ── Change 1: extracted still works for step context passing ──

describe("executeActions — extracted still works for context passing", () => {
  it("extracted from js object return merges into running context", () => {
    const result = executeActions(
      [
        { js: `return { x: 10 };` },
        { js: `return { y: lrail.get("x") + 5 };` },
      ],
      {},
    );
    assert.equal(result.extracted.x, 10);
    assert.equal(result.extracted.y, 15);
  });

  it("extracted from lrail.set() merges into running context", () => {
    const result = executeActions(
      [
        { js: `lrail.set({ fromSet: "hello" }); return "done";` },
        { js: `return { got: lrail.get("fromSet") };` },
      ],
      {},
    );
    assert.equal(result.extracted.fromSet, "hello");
    assert.equal(result.extracted.got, "hello");
    // stdout is from the last action
    assert.equal(result.stdout, '{"got":"hello"}');
  });

  it("extracted from shell extract merges into running context", () => {
    const result = executeActions(
      [
        { shell: `echo '{"count": 5}'`, extract: { count: "count" } },
        { js: `return { doubled: lrail.get("count") * 2 };` },
      ],
      {},
    );
    assert.equal(result.extracted.count, 5);
    assert.equal(result.extracted.doubled, 10);
  });
});

// ── goto from actions still works ──

describe("executeActions — goto flow control", () => {
  it("goto stops the chain and is returned in result", () => {
    const result = executeActions(
      [
        { js: `return lrail.goto("target-step");` },
        { js: `return { shouldNotRun: true };` },
      ],
      {},
    );
    assert.ok(result.goto instanceof LrailGoto);
    assert.equal(result.goto.target, "target-step");
    // The second action should NOT have run
    assert.equal(result.extracted.shouldNotRun, undefined);
  });

  it("goto returns stdout from the goto action", () => {
    const result = executeActions(
      [
        { js: `return lrail.goto("next");` },
      ],
      {},
    );
    assert.ok(result.goto instanceof LrailGoto);
    assert.equal(result.goto.target, "next");
    // stdout contains the goto brand object JSON
    assert.ok(result.stdout !== undefined);
  });

  it("goto after some actions — accumulated extracted is preserved", () => {
    const result = executeActions(
      [
        { js: `return { before: "value" };` },
        { js: `return lrail.goto("skip");` },
        { js: `return { after: "should-not-exist" };` },
      ],
      {},
    );
    assert.ok(result.goto instanceof LrailGoto);
    assert.equal(result.goto.target, "skip");
    assert.equal(result.extracted.before, "value");
    assert.equal(result.extracted.after, undefined);
  });
});

// ── Change 2: tool command prints stdout (integration-style test via actions) ──
// The tool command uses executeActions and then prints result.stdout.
// We test the same path: executeActions result.stdout is what would be printed.

describe("tool output behavior — executeActions stdout for tool use cases", () => {
  it("tool returning a string: stdout is raw string (no JSON wrapping)", () => {
    const result = executeActions(
      [{ js: `return "The form was submitted successfully.";` }],
      {},
    );
    // This is what the tool command would print via console.log(result.stdout)
    assert.equal(result.stdout, "The form was submitted successfully.");
    // No { extracted: ... } wrapper
    assert.ok(!result.stdout.includes("extracted"));
  });

  it("tool returning an object: stdout is JSON-stringified object (no extracted wrapper)", () => {
    const result = executeActions(
      [{ js: `return { status: "ok", count: 3 };` }],
      {},
    );
    // The tool command prints result.stdout, which is the JSON of the object itself
    assert.equal(result.stdout, '{"status":"ok","count":3}');
    // NOT wrapped in { extracted: {...} }
    const parsed = JSON.parse(result.stdout!);
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.count, 3);
    assert.equal(parsed.extracted, undefined);
  });

  it("tool returning nothing: stdout is empty string, no crash", () => {
    const result = executeActions(
      [{ js: `// do something but return nothing` }],
      {},
    );
    assert.equal(result.stdout, "");
  });

  it("tool with lrail.set only (no return): stdout is empty", () => {
    const result = executeActions(
      [{ js: `lrail.set({ internal: "data" });` }],
      {},
    );
    assert.equal(result.stdout, "");
    // But extracted still has the set data
    assert.equal(result.extracted.internal, "data");
  });

  it("tool with lrail.set and string return: stdout is the string", () => {
    const result = executeActions(
      [{ js: `lrail.set({ saved: true }); return "Operation complete";` }],
      {},
    );
    assert.equal(result.stdout, "Operation complete");
    assert.equal(result.extracted.saved, true);
  });

  it("tool with shell action: stdout is shell output", () => {
    const result = executeActions(
      [{ shell: `echo "shell tool output"` }],
      {},
    );
    assert.equal(result.stdout, "shell tool output");
  });

  it("tool with multi-action chain: stdout is from last action", () => {
    const result = executeActions(
      [
        { js: `lrail.set({ step1: "done" });` },
        { js: `return "Final result: " + lrail.get("step1");` },
      ],
      {},
    );
    assert.equal(result.stdout, "Final result: done");
    assert.equal(result.extracted.step1, "done");
  });
});
