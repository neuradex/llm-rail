import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import { initialV1State } from "../src/engine/state-v1.js";
import { advance } from "../src/engine/runner-v1.js";
import {
  applyRouterGoto,
  evaluateRouter,
  evaluateWhen,
  RouterResolutionError,
} from "../src/engine/router-v1.js";
import { nowISO } from "../src/util.js";

function mkDef(overrides: Partial<WorkflowV1Def> & { steps: V1StepDef[] }): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name: "router-edge",
    schemas: { Input: { type: "object" }, Output: { type: "object" } },
    input: "Input",
    output: "Output",
    ...overrides,
  };
}

function mkState(def: WorkflowV1Def, input: Record<string, unknown> = {}) {
  return initialV1State(def, "t", undefined, input, nowISO());
}

// ── Empty cases / unconditional default ──
describe("router-v1 — empty cases", () => {
  it("empty cases array always takes default", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Done: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] },
      },
      steps: [
        { id: "r", type: "router", cases: [], default: "end" },
        {
          id: "end",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "x", description: "x", js: "return { tag: 'default-only' };" }],
        },
      ],
    });
    const state = mkState(def);
    const r = advance(def, state);
    assert.equal(r.kind, "completed");
    assert.equal(state.steps.end.output?.tag, "default-only");
  });
});

// ── Nested combinators ──
describe("router-v1 — nested combinators", () => {
  const ctx = { a: 1, b: 2, c: 3 };
  it("all of (any of, not)", () => {
    const expr = {
      all: [
        { any: [{ field: "{{a}}", op: "eq", value: 99 }, { field: "{{b}}", op: "eq", value: 2 }] },
        { not: { field: "{{c}}", op: "eq", value: 99 } },
      ],
    } as const;
    const state = mkState(mkDef({ steps: [{ id: "r", type: "router", cases: [], default: "r" }] }), ctx);
    assert.equal(evaluateWhen(expr, ctx, state, "r"), true);
  });

  it("not of all (de Morgan-style)", () => {
    const expr = {
      not: {
        all: [
          { field: "{{a}}", op: "eq", value: 1 },
          { field: "{{b}}", op: "eq", value: 99 },
        ],
      },
    } as const;
    const state = mkState(mkDef({ steps: [{ id: "r", type: "router", cases: [], default: "r" }] }), ctx);
    assert.equal(evaluateWhen(expr, ctx, state, "r"), true);
  });

  it("array form is implicit AND", () => {
    const expr = [
      { field: "{{a}}", op: "eq", value: 1 },
      { field: "{{b}}", op: "eq", value: 2 },
    ] as const;
    const state = mkState(mkDef({ steps: [{ id: "r", type: "router", cases: [], default: "r" }] }), ctx);
    assert.equal(evaluateWhen(expr as never, ctx, state, "r"), true);
    const expr2 = [
      { field: "{{a}}", op: "eq", value: 1 },
      { field: "{{b}}", op: "eq", value: 99 },
    ] as const;
    assert.equal(evaluateWhen(expr2 as never, ctx, state, "r"), false);
  });
});

// ── Two routers ──
describe("router-v1 — two routers in one workflow", () => {
  it("each router records its own decision independently", () => {
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { x: { type: "integer" } },
          required: ["x"],
        },
        Output: { type: "object" },
        N: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "r1",
          type: "router",
          cases: [{ when: { field: "{{x}}", op: "eq", value: 1 }, goto: "mid" }],
          default: "mid",
        },
        {
          id: "mid",
          type: "programmatic",
          required_output: "N",
          actions: [{ name: "m", description: "m", js: "return { v: 1 };" }],
        },
        {
          id: "r2",
          type: "router",
          cases: [],
          default: "done",
        },
        {
          id: "done",
          type: "programmatic",
          required_output: "N",
          actions: [{ name: "d", description: "d", js: "return { v: 2 };" }],
        },
      ],
    });
    const state = mkState(def, { x: 0 });
    const r = advance(def, state);
    assert.equal(r.kind, "completed");
    // r1 used default (no cases matched: x=0, not 1)
    assert.equal((state.steps.r1.output as { used_default: boolean }).used_default, true);
    // r2 used default (empty cases array)
    assert.equal((state.steps.r2.output as { used_default: boolean }).used_default, true);
    // Both routers completed independently
    assert.equal(state.steps.r1.status, "completed");
    assert.equal(state.steps.r2.status, "completed");
    assert.equal(state.steps.r1.iterations, 1);
    assert.equal(state.steps.r2.iterations, 1);
  });
});

// ── Self-goto ──
describe("router-v1 — self goto", () => {
  it("router whose target is itself loops with max_iterations bound", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Done: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] },
      },
      steps: [
        {
          id: "loop",
          type: "router",
          cases: [{ when: { field: "{{x}}", op: "eq", value: 1 }, goto: "loop" }],
          default: "end",
          max_iterations: 3,
        },
        {
          id: "end",
          type: "programmatic",
          required_output: "Done",
          actions: [{ name: "e", description: "e", js: "return { tag: 'reached' };" }],
        },
      ],
    });
    // x !== 1 → goes to default immediately
    const state = mkState(def, { x: 0 });
    const r = advance(def, state);
    assert.equal(r.kind, "completed");
    assert.equal(state.steps.end.output?.tag, "reached");
  });

  it("self-goto hits max_iterations and surfaces an error", () => {
    const def = mkDef({
      schemas: { Input: { type: "object" }, Output: { type: "object" } },
      steps: [
        {
          id: "loop",
          type: "router",
          cases: [{ when: { field: "{{x}}", op: "eq", value: 1 }, goto: "loop" }],
          default: "end",
          max_iterations: 3,
        },
        {
          id: "end",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "e", description: "e", js: "return {};" }],
        },
      ],
    });
    const state = mkState(def, { x: 1 });
    const r = advance(def, state);
    assert.equal(r.kind, "error");
    assert.match(r.error?.message ?? "", /max_iterations/);
  });
});

// ── Backward goto reset window ──
describe("router-v1 — backward reset window", () => {
  it("resets every step in [target, routerId] (inclusive)", () => {
    const stepOrder = ["a", "b", "c", "router", "after"];
    const state = mkState(mkDef({ steps: [] }));
    state.steps = {
      a: { status: "completed", output: { v: 1 } },
      b: { status: "completed", output: { v: 2 } },
      c: { status: "completed", output: { v: 3 } },
      router: { status: "completed", output: {}, iterations: 0 },
      after: { status: "pending" },
    };

    const router = {
      id: "router",
      type: "router",
      cases: [],
      default: "a",
      max_iterations: 5,
    } as const;
    const result = applyRouterGoto(router as never, "b", stepOrder, state);
    assert.equal(result.backward, true);
    assert.deepEqual(result.resetStepIds, ["b", "c", "router"]);
    // a is preserved (before the window)
    assert.equal(state.steps.a.status, "completed");
    assert.equal(state.steps.a.output?.v, 1);
    // b through router are reset
    for (const id of ["b", "c", "router"]) {
      assert.equal(state.steps[id].status, "pending");
      assert.equal(state.steps[id].output, undefined);
    }
    // after is untouched (was already pending)
    assert.equal(state.steps.after.status, "pending");
    assert.equal(state.current_step_id, "b");
  });

  it("forward goto resets nothing", () => {
    const stepOrder = ["router", "a", "b", "c"];
    const state = mkState(mkDef({ steps: [] }));
    state.steps = {
      router: { status: "completed", output: {} },
      a: { status: "completed", output: { v: 1 } },
      b: { status: "pending" },
      c: { status: "pending" },
    };
    const router = { id: "router", type: "router", cases: [], default: "a" } as const;
    const result = applyRouterGoto(router as never, "c", stepOrder, state);
    assert.equal(result.backward, false);
    assert.deepEqual(result.resetStepIds, []);
    assert.equal(state.steps.a.status, "completed");
    assert.equal(state.steps.a.output?.v, 1);
    assert.equal(state.current_step_id, "c");
  });
});

// ── Reference resolution edges ──
describe("router-v1 — reference errors", () => {
  it("references a pending step in when.field → RouterResolutionError", () => {
    const def = mkDef({
      steps: [
        {
          id: "r",
          type: "router",
          cases: [{ when: { field: "{ghost.x}", op: "eq", value: 1 }, goto: "end" }],
          default: "end",
        },
        {
          id: "end",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "e", description: "e", js: "return {};" }],
        },
      ],
    });
    const state = mkState(def);
    const r = advance(def, state);
    assert.equal(r.kind, "error");
    assert.ok(r.error instanceof RouterResolutionError, "should be RouterResolutionError");
  });

  it("malformed reference → RouterResolutionError", () => {
    const ctx = {};
    const state = mkState(mkDef({ steps: [{ id: "r", type: "router", cases: [], default: "r" }] }));
    assert.throws(
      () => evaluateRouter(
        {
          id: "r",
          type: "router",
          cases: [{ when: { field: "naked.field", op: "eq", value: 1 }, goto: "x" }],
          default: "y",
        } as never,
        ctx,
        state,
      ),
      /not a valid reference/,
    );
  });
});

// ── when.value as a reference ──
describe("router-v1 — when.value reference", () => {
  it("resolves when.value as a {{input}} reference for dynamic comparison", () => {
    // Verify the router's *decision* (not downstream sequencing): the
    // router output records selected_goto / used_default / case_index.
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { target: { type: "integer" } },
          required: ["target"],
        },
        Output: { type: "object" },
        N: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "src",
          type: "programmatic",
          required_output: "N",
          actions: [{ name: "s", description: "s", js: "return { v: 5 };" }],
        },
        {
          id: "r",
          type: "router",
          cases: [
            { when: { field: "{src.v}", op: "eq", value: "{{target}}" }, goto: "tail" },
          ],
          default: "tail",
        },
        {
          id: "tail",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "t", description: "t", js: "return {};" }],
        },
      ],
    });

    const state1 = mkState(def, { target: 5 });
    advance(def, state1);
    assert.deepEqual(state1.steps.r.output, {
      selected_goto: "tail",
      selected_case: 0,
      used_default: false,
    });

    const state2 = mkState(def, { target: 99 });
    advance(def, state2);
    assert.deepEqual(state2.steps.r.output, {
      selected_goto: "tail",
      selected_case: -1,
      used_default: true,
    });
  });

  it("resolves when.value as a {step.field} reference", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        N: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "left",
          type: "programmatic",
          required_output: "N",
          actions: [{ name: "l", description: "l", js: "return { v: 7 };" }],
        },
        {
          id: "right",
          type: "programmatic",
          required_output: "N",
          actions: [{ name: "r", description: "r", js: "return { v: 7 };" }],
        },
        {
          id: "r",
          type: "router",
          cases: [
            { when: { field: "{left.v}", op: "eq", value: "{right.v}" }, goto: "tail" },
          ],
          default: "tail",
        },
        {
          id: "tail",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "t", description: "t", js: "return {};" }],
        },
      ],
    });
    const state = mkState(def);
    advance(def, state);
    assert.equal((state.steps.r.output as { used_default: boolean }).used_default, false);
  });
});
