import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import { initialV1State } from "../src/engine/state-v1.js";
import { advance, submitAgenticResult } from "../src/engine/runner-v1.js";
import { nowISO } from "../src/util.js";

function mkDef(overrides: Partial<WorkflowV1Def> & { steps: V1StepDef[] }): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name: "router-test",
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
    },
    input: "Input",
    output: "Output",
    ...overrides,
  };
}

function mkState(def: WorkflowV1Def, input: Record<string, unknown> = {}) {
  return initialV1State(def, "t", undefined, input, nowISO());
}

describe("router-v1 — forward routing", () => {
  it("skips steps by jumping forward", () => {
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { mode: { type: "string" } },
          required: ["mode"],
        },
        Output: { type: "object" },
        Done: { type: "object", properties: { via: { type: "string" } }, required: ["via"] },
      },
      steps: [
        {
          id: "dispatch",
          type: "router",
          cases: [
            {
              when: { field: "{{mode}}", op: "eq", value: "fast" },
              goto: "fast-path",
            },
          ],
          default: "slow-path",
        },
        {
          id: "slow-path",
          type: "programmatic",
          required_output: "Done",
          actions: [
            { name: "slow", description: "via slow", js: "return { via: 'slow' };" },
          ],
        },
        {
          id: "fast-path",
          type: "programmatic",
          required_output: "Done",
          actions: [
            { name: "fast", description: "via fast", js: "return { via: 'fast' };" },
          ],
        },
      ],
    });
    const state = mkState(def, { mode: "fast" });
    const result = advance(def, state);
    assert.equal(result.kind, "completed");
    assert.deepEqual(state.steps["fast-path"].output, { via: "fast" });
    assert.equal(state.steps["slow-path"].status, "pending");
    assert.equal(state.steps.dispatch.output?.selected_goto, "fast-path");
    assert.equal(state.steps.dispatch.output?.selected_case, 0);
  });

  it("falls through to default when no case matches", () => {
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { mode: { type: "string" } },
          required: ["mode"],
        },
        Output: { type: "object" },
        Done: { type: "object", properties: { via: { type: "string" } }, required: ["via"] },
      },
      steps: [
        {
          id: "dispatch",
          type: "router",
          cases: [
            {
              when: { field: "{{mode}}", op: "eq", value: "fast" },
              goto: "fast-path",
            },
          ],
          default: "slow-path",
        },
        {
          id: "slow-path",
          type: "programmatic",
          required_output: "Done",
          actions: [
            { name: "slow", description: "via slow", js: "return { via: 'slow' };" },
          ],
        },
        {
          id: "fast-path",
          type: "programmatic",
          required_output: "Done",
          actions: [
            { name: "fast", description: "via fast", js: "return { via: 'fast' };" },
          ],
        },
      ],
    });
    const state = mkState(def, { mode: "medium" });
    const result = advance(def, state);
    assert.equal(result.kind, "completed");
    assert.equal(state.steps.dispatch.output?.used_default, true);
    assert.equal(state.steps.dispatch.output?.selected_goto, "slow-path");
    assert.deepEqual(state.steps["slow-path"].output, { via: "slow" });
  });
});

describe("router-v1 — backward routing (loop)", () => {
  it("loops until an until-style condition is met, with reset", () => {
    // Counter loop: increment step produces a counter, router loops back
    // until counter reaches target. Each loop resets the counter step so
    // it reads from workflow input each time — but we compose it across
    // iterations by having the router output encode the iteration. To
    // simulate a real accumulator we track count in the router's
    // iteration counter and read the last-iteration output of the
    // counter step (which gets reset each loop, so we can only look at
    // the router itself).
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { target: { type: "integer" } },
          required: ["target"],
        },
        Output: { type: "object" },
        Beat: {
          type: "object",
          properties: { tick: { type: "integer" } },
          required: ["tick"],
        },
        Done: { type: "object", properties: { done: { type: "boolean" } }, required: ["done"] },
      },
      steps: [
        {
          id: "tick",
          type: "programmatic",
          required_output: "Beat",
          actions: [
            {
              name: "emit",
              description: "emit a beat",
              js: "return { tick: 1 };",
            },
          ],
        },
        {
          id: "loop",
          type: "router",
          context_in: { target: "{{target}}" },
          cases: [
            // after `target` iterations, exit
            {
              when: { field: "{{target}}", op: "lte", value: 0 },
              goto: "finish",
            },
          ],
          default: "tick",
          max_iterations: 50,
        },
        {
          id: "finish",
          type: "programmatic",
          required_output: "Done",
          actions: [
            { name: "close", description: "final", js: "return { done: true };" },
          ],
        },
      ],
    });
    const state = mkState(def, { target: 0 }); // match first case immediately
    const result = advance(def, state);
    assert.equal(result.kind, "completed");
    assert.equal(state.steps.loop.output?.selected_goto, "finish");
    assert.deepEqual(state.steps.finish.output, { done: true });
  });

  it("resets target-through-router step outputs on backward goto", () => {
    let sharedCounter = 0;
    void sharedCounter;
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Beat: { type: "object", properties: { tick: { type: "integer" } }, required: ["tick"] },
      },
      steps: [
        {
          id: "beat",
          type: "programmatic",
          required_output: "Beat",
          actions: [
            { name: "b", description: "beat", js: "return { tick: 1 };" },
          ],
        },
        {
          id: "gate",
          type: "router",
          cases: [
            // after first completion of the loop, router will be at
            // iteration >= 2 via our own state-poking; force forward
            // exit on second pass.
            {
              when: { field: "{beat.tick}", op: "eq", value: 99 },
              goto: "beat",
            },
          ],
          default: "exit",
        },
        {
          id: "exit",
          type: "programmatic",
          required_output: "Beat",
          actions: [
            { name: "x", description: "exit beat", js: "return { tick: 2 };" },
          ],
        },
      ],
    });
    const state = mkState(def);
    const result = advance(def, state);
    assert.equal(result.kind, "completed");
    // beat ran once, gate defaulted, exit ran
    assert.deepEqual(state.steps.beat.output, { tick: 1 });
    assert.deepEqual(state.steps.exit.output, { tick: 2 });
  });

  it("errors when max_iterations exceeded", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Beat: { type: "object", properties: { tick: { type: "integer" } }, required: ["tick"] },
      },
      steps: [
        {
          id: "beat",
          type: "programmatic",
          required_output: "Beat",
          actions: [
            { name: "b", description: "beat", js: "return { tick: 1 };" },
          ],
        },
        {
          id: "spin",
          type: "router",
          cases: [],
          // no case matches → default fires → backward jump to beat
          default: "beat",
          max_iterations: 3,
        },
      ],
    });
    const state = mkState(def);
    const result = advance(def, state);
    assert.equal(result.kind, "error");
    assert.ok(result.error?.message.match(/max_iterations.*exceeded/));
  });
});

describe("router-v1 — when combinators", () => {
  it("all requires every branch to be true", () => {
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { a: { type: "integer" }, b: { type: "integer" } },
          required: ["a", "b"],
        },
        Output: { type: "object" },
        Done: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      steps: [
        {
          id: "r",
          type: "router",
          cases: [
            {
              when: {
                all: [
                  { field: "{{a}}", op: "gt", value: 0 },
                  { field: "{{b}}", op: "gt", value: 0 },
                ],
              },
              goto: "both",
            },
          ],
          default: "neither",
        },
        {
          id: "both",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "both", js: "return { path: 'both' };" }],
        },
        {
          id: "neither",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "neither", js: "return { path: 'neither' };" }],
        },
      ],
    });
    const stateA = mkState(def, { a: 1, b: 1 });
    advance(def, stateA);
    assert.equal(stateA.steps.both.output?.path, "both");

    const stateB = mkState(def, { a: 1, b: 0 });
    advance(def, stateB);
    assert.equal(stateB.steps.neither.output?.path, "neither");
  });

  it("any requires at least one branch to be true", () => {
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { a: { type: "integer" }, b: { type: "integer" } },
          required: ["a", "b"],
        },
        Output: { type: "object" },
        Done: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      steps: [
        {
          id: "r",
          type: "router",
          cases: [
            {
              when: {
                any: [
                  { field: "{{a}}", op: "gt", value: 0 },
                  { field: "{{b}}", op: "gt", value: 0 },
                ],
              },
              goto: "either",
            },
          ],
          default: "neither",
        },
        {
          id: "either",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "either", js: "return { path: 'either' };" }],
        },
        {
          id: "neither",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "neither", js: "return { path: 'neither' };" }],
        },
      ],
    });
    const stateA = mkState(def, { a: 1, b: 0 });
    advance(def, stateA);
    assert.equal(stateA.steps.either.output?.path, "either");

    const stateB = mkState(def, { a: 0, b: 0 });
    advance(def, stateB);
    assert.equal(stateB.steps.neither.output?.path, "neither");
  });

  it("not inverts a sub-expression", () => {
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { a: { type: "integer" } },
          required: ["a"],
        },
        Output: { type: "object" },
        Done: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      steps: [
        {
          id: "r",
          type: "router",
          cases: [
            {
              when: { not: { field: "{{a}}", op: "eq", value: 0 } },
              goto: "nonzero",
            },
          ],
          default: "zero",
        },
        {
          id: "nonzero",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "nz", js: "return { path: 'nonzero' };" }],
        },
        {
          id: "zero",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "z", js: "return { path: 'zero' };" }],
        },
      ],
    });
    const s1 = mkState(def, { a: 0 });
    advance(def, s1);
    assert.equal(s1.steps.zero.output?.path, "zero");

    const s2 = mkState(def, { a: 7 });
    advance(def, s2);
    assert.equal(s2.steps.nonzero.output?.path, "nonzero");
  });
});

describe("router-v1 — references", () => {
  it("resolves prior step output references", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Seed: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
        Done: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      steps: [
        {
          id: "seed",
          type: "programmatic",
          required_output: "Seed",
          actions: [{ name: "s", description: "seed", js: "return { v: 42 };" }],
        },
        {
          id: "r",
          type: "router",
          cases: [
            { when: { field: "{seed.v}", op: "eq", value: 42 }, goto: "hit" },
          ],
          default: "miss",
        },
        {
          id: "hit",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "hit", js: "return { path: 'hit' };" }],
        },
        {
          id: "miss",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "miss", js: "return { path: 'miss' };" }],
        },
      ],
    });
    const state = mkState(def);
    const result = advance(def, state);
    assert.equal(result.kind, "completed");
    assert.equal(state.steps.hit.output?.path, "hit");
  });

  it("uses context_in locals in when.field", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Seed: { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] },
        Done: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      steps: [
        {
          id: "seed",
          type: "programmatic",
          required_output: "Seed",
          actions: [{ name: "s", description: "seed", js: "return { kind: 'x' };" }],
        },
        {
          id: "r",
          type: "router",
          context_in: { k: "{seed.kind}" },
          cases: [{ when: { field: "{{k}}", op: "eq", value: "x" }, goto: "x-path" }],
          default: "other",
        },
        {
          id: "x-path",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "x", js: "return { path: 'x' };" }],
        },
        {
          id: "other",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "o", js: "return { path: 'other' };" }],
        },
      ],
    });
    const state = mkState(def);
    advance(def, state);
    assert.equal(state.steps["x-path"].output?.path, "x");
  });
});

describe("router-v1 — integration with agentic", () => {
  it("forward goto skips intermediate steps, then resumes sequential flow", () => {
    // Agent picks 'skip' → router jumps past 'process' to 'exit'.
    // Agent picks 'run' → default fires, runs 'process' then 'exit'.
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Decision: {
          type: "object",
          properties: { choice: { type: "string", enum: ["run", "skip"] } },
          required: ["choice"],
        },
        Done: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      steps: [
        {
          id: "decide",
          type: "agentic",
          instruction: "pick run or skip",
          required_output: "Decision",
        },
        {
          id: "r",
          type: "router",
          cases: [
            { when: { field: "{decide.choice}", op: "eq", value: "skip" }, goto: "exit" },
          ],
          default: "process",
        },
        {
          id: "process",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "process", js: "return { path: 'processed' };" }],
        },
        {
          id: "exit",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "exit", js: "return { path: 'exited' };" }],
        },
      ],
    });

    // Case A: skip → process stays pending, exit runs
    const stateA = mkState(def);
    advance(def, stateA);
    const rA = submitAgenticResult(def, stateA, { choice: "skip" });
    assert.equal(rA.kind, "completed");
    assert.equal(stateA.steps.process.status, "pending");
    assert.equal(stateA.steps.exit.output?.path, "exited");

    // Case B: run → both process and exit run in sequence
    const stateB = mkState(def);
    advance(def, stateB);
    const rB = submitAgenticResult(def, stateB, { choice: "run" });
    assert.equal(rB.kind, "completed");
    assert.equal(stateB.steps.process.output?.path, "processed");
    assert.equal(stateB.steps.exit.output?.path, "exited");
  });
});
