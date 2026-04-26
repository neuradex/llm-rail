import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as yaml from "js-yaml";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import {
  initialV1State,
  type V1InstanceState,
} from "../src/engine/state-v1.js";
import { advance, submitAgenticResult } from "../src/engine/runner-v1.js";
import { makeInMemoryRegistry } from "../src/engine/call-v1.js";
import { nowISO } from "../src/util.js";

function mkDef(
  name: string,
  overrides: Partial<WorkflowV1Def> & { steps: V1StepDef[] },
): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name,
    schemas: { Input: { type: "object" }, Output: { type: "object" } },
    input: "Input",
    output: "Output",
    ...overrides,
  };
}

function mkState(def: WorkflowV1Def, input: Record<string, unknown> = {}): V1InstanceState {
  return initialV1State(def, "t-" + def.name, undefined, input, nowISO());
}

// ── 3-level nesting ──
describe("call-v1 — 3-level nesting", () => {
  it("submitAgenticResult at top level routes to deepest agentic in grandchild", () => {
    const grandchild = mkDef("g", {
      schemas: {
        Input: {
          type: "object",
          properties: { x: { type: "integer" } },
          required: ["x"],
        },
        Output: { type: "object", properties: { y: { type: "string" } }, required: ["y"] },
      },
      steps: [
        {
          id: "ask",
          type: "agentic",
          instruction: "Produce y from x={{x}}",
          required_output: "Output",
        },
      ],
    });
    const child = mkDef("c", {
      schemas: {
        Input: {
          type: "object",
          properties: { x: { type: "integer" } },
          required: ["x"],
        },
        Output: { type: "object", properties: { y: { type: "string" } }, required: ["y"] },
      },
      steps: [
        {
          id: "delegate",
          type: "call",
          workflow: "g",
          inputs: { x: "{{x}}" },
        },
      ],
    });
    const parent = mkDef("p", {
      schemas: {
        Input: {
          type: "object",
          properties: { x: { type: "integer" } },
          required: ["x"],
        },
        Output: { type: "object", properties: { y: { type: "string" } }, required: ["y"] },
      },
      steps: [
        {
          id: "delegate",
          type: "call",
          workflow: "c",
          inputs: { x: "{{x}}" },
        },
      ],
    });

    const registry = makeInMemoryRegistry({ p: parent, c: child, g: grandchild });
    const state = mkState(parent, { x: 7 });
    const r1 = advance(parent, state, registry);
    assert.equal(r1.kind, "awaiting_agent");
    assert.equal(r1.pendingStep?.id, "ask");
    // active_call chain: parent → child → grandchild
    assert.equal(state.active_call?.child_workflow_name, "c");
    assert.equal(state.active_call?.child.active_call?.child_workflow_name, "g");

    const r2 = submitAgenticResult(parent, state, { y: "answer" }, registry);
    assert.equal(r2.kind, "completed");
    assert.equal(state.active_call, undefined);
    // Final output rolled up through both calls
    const finalStep = state.steps.delegate;
    assert.deepEqual(finalStep.output, { y: "answer" });
  });
});

// ── active_call YAML roundtrip ──
describe("call-v1 — active_call serialization", () => {
  it("survives a YAML dump/load cycle (nested child state preserved)", () => {
    const child = mkDef("c", {
      schemas: {
        Input: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] },
        Output: { type: "object", properties: { y: { type: "integer" } }, required: ["y"] },
      },
      steps: [
        { id: "ask", type: "agentic", instruction: "ask", required_output: "Output" },
      ],
    });
    const parent = mkDef("p", {
      schemas: {
        Input: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] },
        Output: { type: "object", properties: { y: { type: "integer" } }, required: ["y"] },
      },
      steps: [
        { id: "delegate", type: "call", workflow: "c", inputs: { x: "{{x}}" } },
      ],
    });

    const registry = makeInMemoryRegistry({ p: parent, c: child });
    const state = mkState(parent, { x: 11 });
    advance(parent, state, registry);
    assert.ok(state.active_call, "active_call should exist after pause");

    const dumped = yaml.dump(state);
    const reloaded = yaml.load(dumped) as V1InstanceState;

    // Roundtrip preserves nested state
    assert.equal(reloaded.active_call?.child_workflow_name, "c");
    assert.equal(reloaded.active_call?.step_id, "delegate");
    assert.equal(reloaded.active_call?.child.input.x, 11);
    assert.equal(reloaded.active_call?.child.steps.ask.status, "in_progress");

    // Continue from reloaded state
    const r = submitAgenticResult(parent, reloaded, { y: 22 }, registry);
    assert.equal(r.kind, "completed");
    assert.deepEqual(reloaded.steps.delegate.output, { y: 22 });
  });
});

// ── max_depth boundary ──
describe("call-v1 — max_depth boundary", () => {
  it("max_depth = 1 allows exactly 1 call (no recursion)", () => {
    const inner = mkDef("inner", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "x",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return { v: 1 };" }],
        },
      ],
    });
    const outer = mkDef("outer", {
      max_depth: 1,
      schemas: {
        Input: { type: "object" },
        Output: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        { id: "go", type: "call", workflow: "inner", inputs: {} },
      ],
    });
    const registry = makeInMemoryRegistry({ outer, inner });
    const state = mkState(outer);
    const r = advance(outer, state, registry);
    assert.equal(r.kind, "completed", JSON.stringify(r));
  });

  it("max_depth = 1 rejects 2-level call (off-by-one boundary)", () => {
    const grand = mkDef("g", {
      schemas: { Input: { type: "object" }, Output: { type: "object" } },
      max_depth: 1,
      steps: [
        {
          id: "x",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return {};" }],
        },
      ],
    });
    const middle = mkDef("m", {
      schemas: { Input: { type: "object" }, Output: { type: "object" } },
      max_depth: 1,
      steps: [{ id: "g", type: "call", workflow: "g", inputs: {} }],
    });
    const outer = mkDef("o", {
      schemas: { Input: { type: "object" }, Output: { type: "object" } },
      max_depth: 1,
      steps: [{ id: "m", type: "call", workflow: "m", inputs: {} }],
    });
    const registry = makeInMemoryRegistry({ o: outer, m: middle, g: grand });
    const state = mkState(outer);
    const r = advance(outer, state, registry);
    assert.equal(r.kind, "error");
    assert.match(r.error?.message ?? "", /max_depth/);
  });
});

// ── Output schema validation on collectWorkflowOutput ──
describe("call-v1 — output schema enforcement", () => {
  it("rejects when child's last step output does not match output schema", () => {
    const child = mkDef("c", {
      schemas: {
        Input: { type: "object" },
        Output: {
          type: "object",
          properties: { result: { type: "string" } },
          required: ["result"],
        },
      },
      steps: [
        {
          id: "wrong",
          type: "programmatic",
          // No required_output → child's last step has no schema check.
          // But child output schema requires `result`. Output collection fails.
          actions: [{ name: "x", description: "x", js: "return { wrong_field: 1 };" }],
        },
      ],
    });
    const parent = mkDef("p", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
      },
      steps: [
        { id: "delegate", type: "call", workflow: "c", inputs: {} },
      ],
    });
    const registry = makeInMemoryRegistry({ p: parent, c: child });
    const state = mkState(parent);
    const r = advance(parent, state, registry);
    assert.equal(r.kind, "error");
    assert.match(r.error?.message ?? "", /output does not match/);
  });
});

// ── Reset clears active_call ──
describe("call-v1 — reset of call step drops active_call", () => {
  it("after running advance(), state.active_call is set; resetting clears it", () => {
    // Mirror reset.ts behavior inline since reset is a CLI command.
    const child = mkDef("c", {
      schemas: { Input: { type: "object" }, Output: { type: "object" } },
      steps: [
        { id: "ask", type: "agentic", instruction: "ask", required_output: "Output" },
      ],
    });
    const parent = mkDef("p", {
      schemas: { Input: { type: "object" }, Output: { type: "object" } },
      steps: [
        { id: "delegate", type: "call", workflow: "c", inputs: {} },
      ],
    });
    const registry = makeInMemoryRegistry({ p: parent, c: child });
    const state = mkState(parent);
    advance(parent, state, registry);
    assert.ok(state.active_call);
    // Manual reset of the "delegate" step (mirrors reset.ts)
    state.steps.delegate.status = "pending";
    state.steps.delegate.output = undefined;
    state.active_call = undefined;
    state.current_step_id = "delegate";
    // Resuming should re-spawn the child cleanly
    const r = advance(parent, state, registry);
    assert.equal(r.kind, "awaiting_agent");
    assert.ok(state.active_call);
    assert.equal(state.active_call.child_workflow_name, "c");
  });
});
