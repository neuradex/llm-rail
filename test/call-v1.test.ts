import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import { initialV1State } from "../src/engine/state-v1.js";
import { advance, submitAgenticResult } from "../src/engine/runner-v1.js";
import { makeInMemoryRegistry, V1CallError } from "../src/engine/call-v1.js";
import { nowISO } from "../src/util.js";

function mkDef(
  name: string,
  overrides: Partial<WorkflowV1Def> & { steps: V1StepDef[] },
): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name,
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
  return initialV1State(def, `inst-${def.name}`, undefined, input, nowISO());
}

describe("call-v1 — simple child (programmatic-only)", () => {
  it("invokes child, maps inputs, and surfaces output on the call step", () => {
    const child = mkDef("double", {
      schemas: {
        Input: {
          type: "object",
          properties: { n: { type: "integer" } },
          required: ["n"],
        },
        Output: {
          type: "object",
          properties: { doubled: { type: "integer" } },
          required: ["doubled"],
        },
      },
      steps: [
        {
          id: "compute",
          type: "programmatic",
          context_in: { n: "{{n}}" },
          required_output: "Output",
          actions: [
            {
              name: "double",
              description: "n * 2",
              js: "return { doubled: context.n * 2 };",
            },
          ],
        },
      ],
    });

    const parent = mkDef("parent", {
      schemas: {
        Input: {
          type: "object",
          properties: { start: { type: "integer" } },
          required: ["start"],
        },
        Output: {
          type: "object",
          properties: { final: { type: "integer" } },
          required: ["final"],
        },
        Doubled: {
          type: "object",
          properties: { doubled: { type: "integer" } },
          required: ["doubled"],
        },
      },
      steps: [
        {
          id: "call-double",
          type: "call",
          workflow: "double",
          inputs: { n: "{{start}}" },
        },
        {
          id: "shape",
          type: "programmatic",
          context_in: { doubled: "{call-double.doubled}" },
          required_output: "Output",
          actions: [
            {
              name: "wrap",
              description: "package result",
              js: "return { final: context.doubled };",
            },
          ],
        },
      ],
    });

    const registry = makeInMemoryRegistry({ double: child, parent });
    const state = mkState(parent, { start: 7 });
    const result = advance(parent, state, registry);
    assert.equal(result.kind, "completed");
    assert.deepEqual(state.steps["call-double"].output, { doubled: 14 });
    assert.deepEqual(state.steps.shape.output, { final: 14 });
  });
});

describe("call-v1 — child with agentic step propagates and resumes", () => {
  it("pauses parent at child's agentic, resumes on submit", () => {
    const child = mkDef("ask", {
      schemas: {
        Input: { type: "object" },
        Output: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
        },
      },
      steps: [
        {
          id: "ask",
          type: "agentic",
          instruction: "ask",
          required_output: "Output",
        },
      ],
    });

    const parent = mkDef("wrap", {
      schemas: {
        Input: { type: "object" },
        Output: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
        },
        Answer: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
        },
      },
      steps: [
        {
          id: "call-ask",
          type: "call",
          workflow: "ask",
          inputs: {},
        },
        {
          id: "shape",
          type: "programmatic",
          context_in: { a: "{call-ask.answer}" },
          required_output: "Output",
          actions: [
            {
              name: "passthrough",
              description: "return as-is",
              js: "return { answer: context.a };",
            },
          ],
        },
      ],
    });

    const registry = makeInMemoryRegistry({ ask: child, wrap: parent });
    const state = mkState(parent);

    const r1 = advance(parent, state, registry);
    assert.equal(r1.kind, "awaiting_agent");
    assert.equal(r1.pendingStep?.id, "ask");
    assert.ok(state.active_call, "parent should record the in-flight child");
    assert.equal(state.active_call?.child_workflow_name, "ask");

    const r2 = submitAgenticResult(parent, state, { answer: "hello" }, registry);
    assert.equal(r2.kind, "completed");
    assert.equal(state.active_call, undefined);
    assert.deepEqual(state.steps["call-ask"].output, { answer: "hello" });
    assert.deepEqual(state.steps.shape.output, { answer: "hello" });
  });
});

describe("call-v1 — recursion with accumulator", () => {
  it("recursively calls self via input buffer until base case", () => {
    // collect-until — appends queue heads to pool recursively until queue empty
    const def: WorkflowV1Def = mkDef("collect-until", {
      schemas: {
        Input: {
          type: "object",
          properties: {
            pool: { type: "array", items: { type: "integer" } },
            queue: { type: "array", items: { type: "integer" } },
          },
          required: ["pool", "queue"],
        },
        Output: {
          type: "object",
          properties: {
            pool: { type: "array", items: { type: "integer" } },
          },
          required: ["pool"],
        },
        NextInput: {
          type: "object",
          properties: {
            pool: { type: "array", items: { type: "integer" } },
            queue: { type: "array", items: { type: "integer" } },
          },
          required: ["pool", "queue"],
        },
      },
      max_depth: 50,
      steps: [
        {
          id: "check",
          type: "router",
          cases: [
            {
              when: { field: "{{queue}}", op: "length", value: 0 },
              goto: "return",
            },
          ],
          default: "build-next",
        },
        {
          id: "build-next",
          type: "programmatic",
          context_in: {
            pool: "{{pool}}",
            queue: "{{queue}}",
          },
          required_output: "NextInput",
          actions: [
            {
              name: "advance",
              description: "move queue head into pool",
              js: `
                const head = context.queue[0];
                return {
                  pool: [...context.pool, head],
                  queue: context.queue.slice(1),
                };
              `,
            },
          ],
        },
        {
          id: "recurse",
          type: "call",
          workflow: "collect-until",
          inputs: {
            pool: "{build-next.pool}",
            queue: "{build-next.queue}",
          },
        },
        {
          id: "return",
          type: "programmatic",
          context_in: {
            local_pool: "{{pool}}",
            recursed_pool: { from: "{recurse.pool}", default: null },
          },
          required_output: "Output",
          actions: [
            {
              name: "pick",
              description: "recursed result if present, else base",
              js: `
                return {
                  pool: context.recursed_pool !== null
                    ? context.recursed_pool
                    : context.local_pool,
                };
              `,
            },
          ],
        },
      ],
    });

    const registry = makeInMemoryRegistry({ "collect-until": def });
    const state = mkState(def, { pool: [], queue: [10, 20, 30] });
    const result = advance(def, state, registry);
    assert.equal(result.kind, "completed", (result.error as Error)?.stack);
    assert.deepEqual(state.steps.return.output, { pool: [10, 20, 30] });
  });

  it("rejects recursion past max_depth", () => {
    const def: WorkflowV1Def = mkDef("infinite", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object", properties: { done: { type: "boolean" } }, required: ["done"] },
      },
      max_depth: 3,
      steps: [
        {
          id: "recurse",
          type: "call",
          workflow: "infinite",
          inputs: {},
        },
        {
          id: "finalize",
          type: "programmatic",
          required_output: "Output",
          actions: [
            { name: "end", description: "never reached", js: "return { done: true };" },
          ],
        },
      ],
    });

    const registry = makeInMemoryRegistry({ infinite: def });
    const state = mkState(def);
    const result = advance(def, state, registry);
    assert.equal(result.kind, "error");
    assert.ok(result.error instanceof V1CallError, result.error?.message);
    assert.ok(result.error?.message.includes("max_depth"));
  });
});

describe("call-v1 — input / output schema enforcement", () => {
  it("rejects inputs that fail the child's input schema", () => {
    const child = mkDef("strict", {
      schemas: {
        Input: {
          type: "object",
          properties: { n: { type: "integer", minimum: 1 } },
          required: ["n"],
        },
        Output: { type: "object" },
      },
      steps: [
        {
          id: "noop",
          type: "programmatic",
          required_output: "Output",
          actions: [
            { name: "x", description: "noop", js: "return {};" },
          ],
        },
      ],
    });

    const parent = mkDef("p", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
      },
      steps: [
        {
          id: "call",
          type: "call",
          workflow: "strict",
          inputs: {},
        },
      ],
    });

    const registry = makeInMemoryRegistry({ strict: child, p: parent });
    const state = mkState(parent);
    const result = advance(parent, state, registry);
    assert.equal(result.kind, "error");
    assert.ok(result.error instanceof V1CallError);
    assert.ok(result.error?.message.includes("input"));
  });

  it("rejects unknown workflow names", () => {
    const parent = mkDef("p", {
      steps: [
        {
          id: "call",
          type: "call",
          workflow: "does-not-exist",
          inputs: {},
        },
      ],
    });
    const registry = makeInMemoryRegistry({ p: parent });
    const state = mkState(parent);
    const result = advance(parent, state, registry);
    assert.equal(result.kind, "error");
    assert.ok(result.error?.message.includes("unknown workflow"));
  });
});
