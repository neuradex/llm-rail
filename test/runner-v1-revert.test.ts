import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import { initialV1State } from "../src/engine/state-v1.js";
import {
  advance,
  submitAgenticResult,
  V1AssertionFailure,
  V1RunnerError,
} from "../src/engine/runner-v1.js";
import { nowISO } from "../src/util.js";

function mkDef(overrides: Partial<WorkflowV1Def> & { steps: V1StepDef[] }): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name: "rev-test",
    schemas: { Input: { type: "object" }, Output: { type: "object" } },
    input: "Input",
    output: "Output",
    ...overrides,
  };
}

function mkState(def: WorkflowV1Def, input: Record<string, unknown> = {}) {
  return initialV1State(def, "rev-test", undefined, input, nowISO());
}

// ── Agentic validation failure (residual rules) → stays in_progress ──
describe("runner-v1 — agentic validation rule failure", () => {
  it("schema passes, validation rule fails: step stays in_progress, no output", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
      steps: [
        {
          id: "ask",
          type: "agentic",
          instruction: "produce url",
          required_output: "Output",
          validation: [{ field: "url", op: "matches", value: "^https://" }],
        },
      ],
    });
    const state = mkState(def);
    advance(def, state);
    assert.equal(state.steps.ask.status, "in_progress");

    assert.throws(
      () => submitAgenticResult(def, state, { url: "ftp://oops" }),
      (e: Error) => e instanceof V1AssertionFailure && e.kind === "validation",
    );

    // Stays in_progress, no output
    assert.equal(state.steps.ask.status, "in_progress");
    assert.equal(state.steps.ask.output, undefined);
    assert.equal(state.last_completed_step_id, null);

    // Retry succeeds
    submitAgenticResult(def, state, { url: "https://ok" });
    assert.equal(state.steps.ask.status, "completed");
    assert.deepEqual(state.steps.ask.output, { url: "https://ok" });
  });
});

// ── Agentic assertions failure (post-completion) → reverts ──
describe("runner-v1 — agentic assertions failure reverts the step", () => {
  it("clears output, decrements iterations, and rolls last_completed_step_id back", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: {
          type: "object",
          properties: { count: { type: "integer" } },
          required: ["count"],
        },
        Mid: {
          type: "object",
          properties: { v: { type: "integer" } },
          required: ["v"],
        },
      },
      steps: [
        {
          id: "first",
          type: "programmatic",
          required_output: "Mid",
          actions: [{ name: "x", description: "x", js: "return { v: 1 };" }],
        },
        {
          id: "ask",
          type: "agentic",
          instruction: "produce a count >= 10",
          required_output: "Output",
          assertions: [{ field: "count", op: "min", value: 10 }],
        },
      ],
    });
    const state = mkState(def);
    advance(def, state);
    assert.equal(state.steps.first.status, "completed");
    assert.equal(state.last_completed_step_id, "first");

    // Submit a value that passes schema but fails assertion
    assert.throws(
      () => submitAgenticResult(def, state, { count: 5 }),
      (e: Error) => e instanceof V1AssertionFailure && e.kind === "assertions",
    );

    // After revert: step is back to in_progress with no output
    assert.equal(state.steps.ask.status, "in_progress");
    assert.equal(state.steps.ask.output, undefined);
    assert.equal(state.steps.ask.completed_at, undefined);
    assert.equal(state.steps.ask.iterations ?? 0, 0);
    // last_completed_step_id rolled back to prior step
    assert.equal(state.last_completed_step_id, "first");

    // Retry passes
    submitAgenticResult(def, state, { count: 42 });
    assert.equal(state.steps.ask.status, "completed");
    assert.deepEqual(state.steps.ask.output, { count: 42 });
    assert.equal(state.last_completed_step_id, "ask");
  });
});

// ── Programmatic step validation/assertions ──
describe("runner-v1 — programmatic step validation rule", () => {
  it("validation failure halts the workflow with V1AssertionFailure", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] },
      },
      steps: [
        {
          id: "p",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return { x: 5 };" }],
          validation: [{ field: "x", op: "min", value: 10 }],
        },
      ],
    });
    const state = mkState(def);
    const r = advance(def, state);
    assert.equal(r.kind, "error");
    assert.ok(r.error instanceof V1AssertionFailure);
    assert.equal((r.error as V1AssertionFailure).kind, "validation");
  });
});

describe("runner-v1 — programmatic step assertions revert", () => {
  it("post-completion assertion failure reverts the step (output cleared) and surfaces error", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: {
          type: "object",
          properties: { items: { type: "array", items: { type: "integer" } } },
          required: ["items"],
        },
      },
      steps: [
        {
          id: "p",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return { items: [] };" }],
          assertions: [{ field: "items", op: "min_length", value: 1 }],
        },
      ],
    });
    const state = mkState(def);
    const r = advance(def, state);
    assert.equal(r.kind, "error");
    // Step is reverted: pending status, no output
    assert.equal(state.steps.p.status, "pending");
    assert.equal(state.steps.p.output, undefined);
  });
});

// ── Submit on non-agentic / no current step ──
describe("runner-v1 — submit edge cases", () => {
  it("rejects submit when current step is not agentic", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] },
      },
      steps: [
        {
          id: "p",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return { x: 1 };" }],
        },
      ],
    });
    const state = mkState(def);
    // Don't run advance; current step is programmatic but pending
    assert.throws(
      () => submitAgenticResult(def, state, { x: 1 }),
      (e: Error) => e instanceof V1RunnerError && /non-agentic/.test(e.message),
    );
  });

  it("rejects submit when there is no current step", () => {
    const def = mkDef({
      schemas: { Input: { type: "object" }, Output: { type: "object" } },
      steps: [
        {
          id: "p",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return {};" }],
        },
      ],
    });
    const state = mkState(def);
    advance(def, state); // completes
    state.current_step_id = null;
    assert.throws(
      () => submitAgenticResult(def, state, {}),
      (e: Error) => e instanceof V1RunnerError && /no current step/.test(e.message),
    );
  });
});

// ── priorCompletedId picks the most-recent prior step ──
describe("runner-v1 — priorCompletedId rolls back correctly through revert", () => {
  it("after revert, last_completed_step_id is the most-recent OTHER completed step (by completed_at)", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: {
          type: "object",
          properties: { tag: { type: "string" } },
          required: ["tag"],
        },
        Mid: {
          type: "object",
          properties: { v: { type: "integer" } },
          required: ["v"],
        },
      },
      steps: [
        {
          id: "a",
          type: "programmatic",
          required_output: "Mid",
          actions: [{ name: "x", description: "x", js: "return { v: 1 };" }],
        },
        {
          id: "b",
          type: "programmatic",
          required_output: "Mid",
          actions: [{ name: "x", description: "x", js: "return { v: 2 };" }],
        },
        {
          id: "ask",
          type: "agentic",
          instruction: "produce tag",
          required_output: "Output",
          assertions: [{ field: "tag", op: "eq", value: "good" }],
        },
      ],
    });
    const state = mkState(def);
    advance(def, state);
    assert.equal(state.last_completed_step_id, "b");

    assert.throws(
      () => submitAgenticResult(def, state, { tag: "bad" }),
      (e: Error) => e instanceof V1AssertionFailure,
    );

    // last_completed_step_id rolled back to the most recently completed
    // OTHER step, which is 'b' (most recent before 'ask').
    assert.equal(state.last_completed_step_id, "b");
  });
});
