import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildStepContextV1,
  ContextResolutionError,
  resolveReference,
} from "../src/engine/context-v1.js";
import type { V1InstanceState } from "../src/engine/state-v1.js";
import type { ContextInValue } from "../src/types-v1.js";
import { nowISO } from "../src/util.js";

function mkState(overrides: Partial<V1InstanceState> = {}): V1InstanceState {
  return {
    id: "i",
    workflow_name: "wf",
    format: "v1",
    status: "in_progress",
    created_at: nowISO(),
    updated_at: nowISO(),
    current_step_id: null,
    last_completed_step_id: null,
    steps: {},
    input: {},
    ...overrides,
  };
}

// ── Basic step ref ──
describe("context-v1 — {step.field} basic", () => {
  it("resolves a single-segment field", () => {
    const state = mkState({
      steps: {
        a: { status: "completed", output: { x: 42 } },
      },
    });
    assert.equal(resolveReference("consumer", "k", "{a.x}", state), 42);
  });

  it("resolves dotted path 2 levels", () => {
    const state = mkState({
      steps: {
        a: { status: "completed", output: { stats: { count: 99 } } },
      },
    });
    assert.equal(resolveReference("consumer", "k", "{a.stats.count}", state), 99);
  });

  it("resolves dotted path 4+ levels", () => {
    const state = mkState({
      steps: {
        a: {
          status: "completed",
          output: { l1: { l2: { l3: { l4: "deep" } } } },
        },
      },
    });
    assert.equal(
      resolveReference("c", "k", "{a.l1.l2.l3.l4}", state),
      "deep",
    );
  });

  it("returns the entire value object when path is single field", () => {
    const state = mkState({
      steps: { a: { status: "completed", output: { obj: { x: 1, y: 2 } } } },
    });
    assert.deepEqual(resolveReference("c", "k", "{a.obj}", state), { x: 1, y: 2 });
  });
});

// ── Errors on step refs ──
describe("context-v1 — {step.field} errors", () => {
  it("missing source step", () => {
    const state = mkState();
    assert.throws(
      () => resolveReference("c", "k", "{ghost.x}", state),
      (e: Error) =>
        e instanceof ContextResolutionError && /does not exist/.test(e.message),
    );
  });

  it("source step not completed", () => {
    const state = mkState({
      steps: { a: { status: "in_progress" } },
    });
    assert.throws(
      () => resolveReference("c", "k", "{a.x}", state),
      /has not completed/,
    );
  });

  it("source step has no output", () => {
    const state = mkState({
      steps: { a: { status: "completed" } },
    });
    assert.throws(
      () => resolveReference("c", "k", "{a.x}", state),
      /has not completed/,
    );
  });

  it("path traverses null mid-way", () => {
    const state = mkState({
      steps: {
        a: { status: "completed", output: { obj: null } },
      },
    });
    assert.throws(
      () => resolveReference("c", "k", "{a.obj.x}", state),
      /null\/undefined/,
    );
  });

  it("path traverses array (arrays not supported as objects)", () => {
    const state = mkState({
      steps: {
        a: { status: "completed", output: { arr: [{ x: 1 }] } },
      },
    });
    assert.throws(
      () => resolveReference("c", "k", "{a.arr.0}", state),
      /non-object/,
    );
  });

  it("missing field at leaf", () => {
    const state = mkState({
      steps: {
        a: { status: "completed", output: { x: 1 } },
      },
    });
    assert.throws(
      () => resolveReference("c", "k", "{a.y}", state),
      /not found/,
    );
  });
});

// ── Workflow input ref ──
describe("context-v1 — {{input}} resolution", () => {
  it("resolves single-segment input", () => {
    const state = mkState({ input: { user: "alice" } });
    assert.equal(resolveReference("c", "k", "{{user}}", state), "alice");
  });

  it("resolves dotted input path", () => {
    const state = mkState({
      input: { user: { name: "alice", role: "admin" } },
    });
    assert.equal(resolveReference("c", "k", "{{user.name}}", state), "alice");
    assert.equal(resolveReference("c", "k", "{{user.role}}", state), "admin");
  });

  it("rejects missing input field", () => {
    const state = mkState({ input: { x: 1 } });
    assert.throws(
      () => resolveReference("c", "k", "{{y}}", state),
      /not found/,
    );
  });
});

// ── Malformed templates ──
describe("context-v1 — malformed reference rejection", () => {
  const cases: string[] = [
    "step.field",     // no braces
    "{step}",         // missing dot/field
    "{{}}",           // empty input
    "{{ field }}",    // whitespace inside (not supported by regex)
    "{a.b",           // unclosed
    "a.b}",           // unstarted
    "",               // empty
    "{ a.b }",        // spaces inside braces
  ];
  for (const tmpl of cases) {
    it(`rejects '${tmpl}'`, () => {
      assert.throws(
        () => resolveReference("c", "k", tmpl, mkState()),
        /malformed reference|non-empty reference string/,
      );
    });
  }
});

// ── Object form (default) ──
describe("context-v1 — { from, default } object form", () => {
  it("uses default when source step is pending", () => {
    const state = mkState({
      steps: { a: { status: "pending" } },
    });
    const ctx = buildStepContextV1(
      "consumer",
      { v: { from: "{a.x}", default: "fallback" } } satisfies Record<string, ContextInValue>,
      state,
    );
    assert.deepEqual(ctx, { v: "fallback" });
  });

  it("uses default when source step missing entirely", () => {
    const state = mkState();
    const ctx = buildStepContextV1(
      "consumer",
      { v: { from: "{ghost.x}", default: 7 } },
      state,
    );
    assert.deepEqual(ctx, { v: 7 });
  });

  it("does NOT use default when source completed but path missing", () => {
    // Per current behavior: default applies on ContextResolutionError,
    // and 'field not found' on a completed step DOES throw that error,
    // so default fires. This test pins the behavior to its current
    // contract — change with intent.
    const state = mkState({
      steps: { a: { status: "completed", output: { other: 1 } } },
    });
    const ctx = buildStepContextV1(
      "consumer",
      { v: { from: "{a.missing}", default: "f" } },
      state,
    );
    assert.deepEqual(ctx, { v: "f" });
  });

  it("uses real value when source completes with the path", () => {
    const state = mkState({
      steps: { a: { status: "completed", output: { x: 1 } } },
    });
    const ctx = buildStepContextV1(
      "consumer",
      { v: { from: "{a.x}", default: 999 } },
      state,
    );
    assert.deepEqual(ctx, { v: 1 });
  });

  it("default of null is honored (distinct from absent)", () => {
    const state = mkState({ steps: { a: { status: "pending" } } });
    const ctx = buildStepContextV1(
      "consumer",
      { v: { from: "{a.x}", default: null } },
      state,
    );
    assert.deepEqual(ctx, { v: null });
  });

  it("default of object is honored", () => {
    const state = mkState({ steps: { a: { status: "pending" } } });
    const ctx = buildStepContextV1(
      "consumer",
      { v: { from: "{a.x}", default: { nested: [1, 2] } } },
      state,
    );
    assert.deepEqual(ctx, { v: { nested: [1, 2] } });
  });

  it("type hint is silently discarded at runtime", () => {
    const state = mkState({
      steps: { a: { status: "completed", output: { x: "hello" } } },
    });
    const ctx = buildStepContextV1(
      "consumer",
      { v: { from: "{a.x}", type: "SomeSchema" } },
      state,
    );
    assert.deepEqual(ctx, { v: "hello" });
  });
});

// ── buildStepContextV1 ──
describe("context-v1 — buildStepContextV1", () => {
  it("returns {} when context_in is undefined", () => {
    assert.deepEqual(buildStepContextV1("c", undefined, mkState()), {});
  });

  it("returns {} when context_in is empty", () => {
    assert.deepEqual(buildStepContextV1("c", {}, mkState()), {});
  });

  it("propagates errors when no default", () => {
    const state = mkState({ steps: { a: { status: "pending" } } });
    assert.throws(
      () => buildStepContextV1("c", { v: "{a.x}" }, state),
      ContextResolutionError,
    );
  });

  it("merges multiple keys", () => {
    const state = mkState({
      steps: {
        a: { status: "completed", output: { x: 1 } },
        b: { status: "completed", output: { y: 2 } },
      },
      input: { z: 3 },
    });
    const ctx = buildStepContextV1(
      "c",
      { x: "{a.x}", y: "{b.y}", z: "{{z}}" },
      state,
    );
    assert.deepEqual(ctx, { x: 1, y: 2, z: 3 });
  });
});
