import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exportGraph, summarizeWhen } from "../src/engine/graph-v1.js";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";

function mk(steps: V1StepDef[], extra: Partial<WorkflowV1Def> = {}): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name: "g",
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
      Mid: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
    },
    input: "Input",
    output: "Output",
    steps,
    ...extra,
  };
}

// ── summarizeWhen edges ──

describe("summarizeWhen — edge cases", () => {
  it("empty array becomes '(true)'", () => {
    assert.equal(summarizeWhen([]), "(true)");
  });
  it("single rule renders inline", () => {
    assert.equal(
      summarizeWhen({ field: "x", op: "eq", value: 5 }),
      "x eq 5",
    );
  });
  it("array of rules joined by AND (no outer parens — used for implicit AND)", () => {
    assert.equal(
      summarizeWhen([
        { field: "x", op: "eq", value: 1 },
        { field: "y", op: "gt", value: 0 },
      ]),
      'x eq 1 AND y gt 0',
    );
  });
  it("all combinator wraps in parens with AND", () => {
    assert.equal(
      summarizeWhen({
        all: [
          { field: "x", op: "eq", value: 1 },
          { field: "y", op: "eq", value: 2 },
        ],
      }),
      "(x eq 1 AND y eq 2)",
    );
  });
  it("any combinator wraps in parens with OR", () => {
    assert.equal(
      summarizeWhen({
        any: [
          { field: "x", op: "eq", value: 1 },
          { field: "y", op: "eq", value: 2 },
        ],
      }),
      "(x eq 1 OR y eq 2)",
    );
  });
  it("not combinator prefixes 'NOT '", () => {
    assert.equal(
      summarizeWhen({ not: { field: "x", op: "eq", value: 1 } }),
      'NOT x eq 1',
    );
  });
  it("nested combinators render compositionally", () => {
    assert.equal(
      summarizeWhen({
        all: [
          { any: [{ field: "a", op: "eq", value: 1 }, { field: "b", op: "eq", value: 2 }] },
          { not: { field: "c", op: "eq", value: 3 } },
        ],
      }),
      "((a eq 1 OR b eq 2) AND NOT c eq 3)",
    );
  });
});

describe("summarizeWhen — value formatting", () => {
  it("string is JSON-quoted", () => {
    assert.equal(
      summarizeWhen({ field: "x", op: "eq", value: "hi" }),
      'x eq "hi"',
    );
  });
  it("null renders as the literal 'null'", () => {
    assert.equal(
      summarizeWhen({ field: "x", op: "eq", value: null }),
      "x eq null",
    );
  });
  it("number renders as bare digits", () => {
    assert.equal(summarizeWhen({ field: "x", op: "eq", value: 42 }), "x eq 42");
  });
  it("boolean renders as true/false", () => {
    assert.equal(summarizeWhen({ field: "x", op: "eq", value: true }), "x eq true");
    assert.equal(summarizeWhen({ field: "x", op: "eq", value: false }), "x eq false");
  });
  it("object/array render as JSON", () => {
    assert.equal(
      summarizeWhen({ field: "x", op: "eq", value: { a: 1 } }),
      'x eq {"a":1}',
    );
    assert.equal(
      summarizeWhen({ field: "x", op: "eq", value: [1, 2] }),
      "x eq [1,2]",
    );
  });
  it("rules with no value render without trailing space", () => {
    assert.equal(summarizeWhen({ field: "x", op: "exists" }), "x exists");
  });
});

// ── backward flag in control_edges ──

describe("graph control_edges — backward flag on router cases", () => {
  it("router-case with target before router → backward: true; after → false/undefined", () => {
    const def = mk([
      { id: "a", type: "programmatic", required_output: "Mid", actions: [{ name: "x", description: "x", js: "return { v: 1 };" }] },
      {
        id: "loop",
        type: "router",
        cases: [
          // Case 0 → 'a' (before loop) → backward
          { when: { field: "{a.v}", op: "lt", value: 10 }, goto: "a" },
          // Case 1 → 'tail' (after loop) → forward
          { when: { field: "{a.v}", op: "gte", value: 10 }, goto: "tail" },
        ],
        default: "tail",
        max_iterations: 5,
      },
      { id: "tail", type: "programmatic", required_output: "Output", actions: [{ name: "x", description: "x", js: "return {};" }] },
    ]);
    const g = exportGraph(def);
    const caseEdges = g.control_edges.filter((e) => e.kind === "router-case");
    const backwardEdge = caseEdges.find((e) => e.case_index === 0);
    const forwardEdge = caseEdges.find((e) => e.case_index === 1);
    assert.equal(backwardEdge?.backward, true);
    assert.equal(forwardEdge?.backward, false);

    // Default → tail (after loop) → forward
    const defaultEdge = g.control_edges.find((e) => e.kind === "router-default");
    assert.equal(defaultEdge?.backward, false);
  });

  it("self-goto router case marks backward: true (target == router itself)", () => {
    const def = mk([
      {
        id: "loop",
        type: "router",
        cases: [{ when: { field: "{{x}}", op: "eq", value: 1 }, goto: "loop" }],
        default: "tail",
        max_iterations: 3,
      },
      { id: "tail", type: "programmatic", required_output: "Output", actions: [{ name: "x", description: "x", js: "return {};" }] },
    ]);
    const g = exportGraph(def);
    const e = g.control_edges.find((e) => e.kind === "router-case" && e.to === "loop");
    assert.equal(e?.backward, true);
  });
});

// ── call-entry external = true ──

describe("graph control_edges — call-entry external", () => {
  it("call step emits a call-entry edge with external: true and target = workflow name", () => {
    const def = mk([
      { id: "delegate", type: "call", workflow: "child-wf", inputs: {} },
    ]);
    const g = exportGraph(def);
    const e = g.control_edges.find((e) => e.kind === "call-entry");
    assert.ok(e);
    assert.equal(e.external, true);
    assert.equal(e.from, "delegate");
    assert.equal(e.to, "child-wf");
  });

  it("call step also emits a sequential edge to the next step (when present)", () => {
    const def = mk([
      { id: "delegate", type: "call", workflow: "x", inputs: {} },
      { id: "after", type: "programmatic", required_output: "Output", actions: [{ name: "x", description: "x", js: "return {};" }] },
    ]);
    const g = exportGraph(def);
    const seq = g.control_edges.find((e) => e.kind === "sequential" && e.from === "delegate");
    assert.ok(seq);
    assert.equal(seq.to, "after");
  });
});

// ── nodes carry actions kind (js vs shell) ──

describe("graph nodes — programmatic action kind discriminator", () => {
  it("each action's kind is 'js' or 'shell'", () => {
    const def = mk([
      {
        id: "p",
        type: "programmatic",
        required_output: "Output",
        actions: [
          { name: "a1", description: "a1", js: "return {};" },
          { name: "a2", description: "a2", shell: "echo hi" },
        ],
      },
    ]);
    const g = exportGraph(def);
    const node = g.nodes.find((n) => n.id === "p");
    assert.deepEqual(
      node?.actions?.map((a) => ({ name: a.name, kind: a.kind })),
      [
        { name: "a1", kind: "js" },
        { name: "a2", kind: "shell" },
      ],
    );
  });
});
