import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import { exportGraph, summarizeWhen } from "../src/engine/graph-v1.js";

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

describe("graph-v1 — metadata & schemas", () => {
  it("preserves workflow identity and schemas block verbatim", () => {
    const def = mkDef("wf", {
      version: "1.2.3",
      description: "a test",
      max_depth: 12,
      schemas: {
        Input: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] },
        Output: { type: "object" },
      },
      steps: [
        {
          id: "s",
          type: "agentic",
          instruction: "do",
          required_output: "Output",
        },
      ],
    });
    const g = exportGraph(def);
    assert.equal(g.format, "v1");
    assert.equal(g.name, "wf");
    assert.equal(g.version, "1.2.3");
    assert.equal(g.description, "a test");
    assert.equal(g.max_depth, 12);
    assert.equal(g.input, "Input");
    assert.equal(g.output, "Output");
    assert.deepEqual(g.schemas, def.schemas);
  });
});

describe("graph-v1 — nodes", () => {
  it("renders each step type's node shape", () => {
    const def = mkDef("all", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "a",
          type: "agentic",
          instruction: "ask",
          required_output: "R",
          description: "asks the agent",
        },
        {
          id: "p",
          type: "programmatic",
          required_output: "R",
          actions: [
            { name: "compute", description: "sum", js: "return { v: 1 };" },
            { name: "fetch", description: "network", shell: "echo {}" },
          ],
        },
        {
          id: "r",
          type: "router",
          cases: [{ when: { field: "{a.v}", op: "eq", value: 1 }, goto: "p" }],
          default: "a",
          max_iterations: 3,
        },
        {
          id: "c",
          type: "call",
          workflow: "other",
          inputs: { x: "{a.v}", y: "{{x}}" },
        },
      ],
    });
    const g = exportGraph(def);

    const [aNode, pNode, rNode, cNode] = g.nodes;

    assert.equal(aNode.type, "agentic");
    assert.equal(aNode.instruction, "ask");
    assert.equal(aNode.required_output, "R");
    assert.equal(aNode.description, "asks the agent");

    assert.equal(pNode.type, "programmatic");
    assert.deepEqual(pNode.actions, [
      { name: "compute", description: "sum", kind: "js" },
      { name: "fetch", description: "network", kind: "shell" },
    ]);
    assert.equal(pNode.required_output, "R");

    assert.equal(rNode.type, "router");
    assert.equal(rNode.default, "a");
    assert.equal(rNode.max_iterations, 3);
    assert.equal(rNode.cases?.[0].goto, "p");
    assert.ok(rNode.cases?.[0].when_summary.includes("eq"));

    assert.equal(cNode.type, "call");
    assert.equal(cNode.workflow, "other");
    assert.deepEqual(cNode.inputs, { x: "{a.v}", y: "{{x}}" });
  });
});

describe("graph-v1 — control edges", () => {
  it("emits sequential edges for agentic/programmatic steps", () => {
    const def = mkDef("seq", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "s1",
          type: "agentic",
          instruction: "a",
          required_output: "R",
        },
        {
          id: "s2",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: 1 };" }],
        },
      ],
    });
    const g = exportGraph(def);
    const seq = g.control_edges.filter((e) => e.kind === "sequential");
    assert.equal(seq.length, 1);
    assert.deepEqual(seq[0], { from: "s1", to: "s2", kind: "sequential" });
  });

  it("router emits case + default edges and NO sequential fall-through", () => {
    const def = mkDef("router", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "seed",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: 1 };" }],
        },
        {
          id: "r",
          type: "router",
          cases: [
            { when: { field: "{seed.v}", op: "gt", value: 0 }, goto: "end" },
            { when: { field: "{seed.v}", op: "eq", value: 0 }, goto: "seed" },
          ],
          default: "end",
          max_iterations: 10,
        },
        {
          id: "end",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "end", js: "return { v: 0 };" }],
        },
      ],
    });
    const g = exportGraph(def);
    const fromRouter = g.control_edges.filter((e) => e.from === "r");
    const cases = fromRouter.filter((e) => e.kind === "router-case");
    const def_ = fromRouter.filter((e) => e.kind === "router-default");
    assert.equal(cases.length, 2);
    assert.equal(def_.length, 1);
    // backward detection: case index 1 goes to 'seed' (before 'r')
    const backward = cases.find((e) => e.to === "seed");
    assert.ok(backward?.backward);
    const forward = cases.find((e) => e.to === "end");
    assert.equal(forward?.backward, false);
    // No sequential edge from router
    assert.equal(
      g.control_edges.filter((e) => e.from === "r" && e.kind === "sequential").length,
      0,
    );
  });

  it("call emits an external call-entry edge + sequential edge to the next step", () => {
    const def = mkDef("caller", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "c",
          type: "call",
          workflow: "helper",
          inputs: {},
        },
        {
          id: "after",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "a", js: "return { v: 1 };" }],
        },
      ],
    });
    const g = exportGraph(def);
    const callEntry = g.control_edges.filter((e) => e.kind === "call-entry");
    assert.equal(callEntry.length, 1);
    assert.equal(callEntry[0].to, "helper");
    assert.ok(callEntry[0].external);
    const seq = g.control_edges.filter((e) => e.kind === "sequential");
    assert.deepEqual(seq, [{ from: "c", to: "after", kind: "sequential" }]);
  });
});

describe("graph-v1 — data edges", () => {
  it("captures context_in step→step references with path preserved", () => {
    const def = mkDef("data", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "src",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: 7 };" }],
        },
        {
          id: "sink",
          type: "programmatic",
          context_in: { val: "{src.v}" },
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: context.val };" }],
        },
      ],
    });
    const g = exportGraph(def);
    assert.deepEqual(g.data_edges, [
      {
        from_step: "src",
        from_field: "v",
        from_path: "v",
        to_step: "sink",
        to_key: "val",
        via: "context_in",
        has_default: false,
      },
    ]);
  });

  it("preserves sub-path in from_path when the reference is dotted (P2)", () => {
    const def = mkDef("data", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Nested: {
          type: "object",
          properties: {
            stats: {
              type: "object",
              properties: { count: { type: "integer" } },
              required: ["count"],
            },
          },
          required: ["stats"],
        },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "src",
          type: "programmatic",
          required_output: "Nested",
          actions: [{ name: "x", description: "x", js: "return { stats: { count: 1 } };" }],
        },
        {
          id: "sink",
          type: "programmatic",
          context_in: { n: "{src.stats.count}" },
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: context.n };" }],
        },
      ],
    });
    const edge = exportGraph(def).data_edges[0];
    assert.equal(edge.from_field, "stats");
    assert.equal(edge.from_path, "stats.count");
  });

  it("captures call.inputs with raw key (no 'inputs.' prefix, P3)", () => {
    const def = mkDef("data", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "src",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: 1 };" }],
        },
        {
          id: "callee",
          type: "call",
          workflow: "helper",
          inputs: { s: "{src.v}" },
        },
        {
          id: "consume",
          type: "programmatic",
          context_in: {
            maybe: { from: "{callee.v}", default: null },
          },
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: 0 };" }],
        },
      ],
    });
    const g = exportGraph(def);
    const callInput = g.data_edges.find((e) => e.via === "call-input");
    assert.deepEqual(callInput, {
      from_step: "src",
      from_field: "v",
      from_path: "v",
      to_step: "callee",
      to_key: "s",
      via: "call-input",
      has_default: false,
    });
    const withDefault = g.data_edges.find((e) => e.to_step === "consume");
    assert.ok(withDefault?.has_default);
  });
});

describe("graph-v1 — input_refs (P1)", () => {
  it("routes {{name}} references to input_refs, not data_edges", () => {
    const def = mkDef("data", {
      schemas: {
        Input: {
          type: "object",
          properties: { start: { type: "integer" } },
          required: ["start"],
        },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "s",
          type: "programmatic",
          context_in: { x: "{{start}}" },
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: context.x };" }],
        },
      ],
    });
    const g = exportGraph(def);
    assert.deepEqual(g.data_edges, []);
    assert.deepEqual(g.input_refs, [
      {
        to_step: "s",
        to_key: "x",
        field: "start",
        path: "start",
        via: "context_in",
        has_default: false,
      },
    ]);
  });

  it("preserves dotted paths in input_refs.path", () => {
    const def = mkDef("data", {
      schemas: {
        Input: {
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
          },
          required: ["user"],
        },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "string" } }, required: ["v"] },
      },
      steps: [
        {
          id: "s",
          type: "programmatic",
          context_in: { greeting: "{{user.name}}" },
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: context.greeting };" }],
        },
      ],
    });
    const ref = exportGraph(def).input_refs[0];
    assert.equal(ref.field, "user");
    assert.equal(ref.path, "user.name");
  });

  it("captures {{name}} refs on call.inputs with raw to_key", () => {
    const def = mkDef("data", {
      schemas: {
        Input: {
          type: "object",
          properties: { api_key: { type: "string" } },
          required: ["api_key"],
        },
        Output: { type: "object" },
      },
      steps: [
        {
          id: "c",
          type: "call",
          workflow: "helper",
          inputs: { token: "{{api_key}}" },
        },
      ],
    });
    const g = exportGraph(def);
    assert.deepEqual(g.data_edges, []);
    assert.deepEqual(g.input_refs, [
      {
        to_step: "c",
        to_key: "token",
        field: "api_key",
        path: "api_key",
        via: "call-input",
        has_default: false,
      },
    ]);
  });
});

describe("graph-v1 — node cases (P4)", () => {
  it("router cases in nodes do NOT carry a placeholder backward field", () => {
    const def = mkDef("r", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "r",
          type: "router",
          cases: [{ when: { field: "{{mode}}", op: "eq", value: "a" }, goto: "a" }],
          default: "a",
        },
        {
          id: "a",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "x", js: "return { v: 1 };" }],
        },
      ],
    });
    const node = exportGraph(def).nodes[0];
    const keys = Object.keys(node.cases?.[0] ?? {});
    assert.ok(!keys.includes("backward"), "nodes[].cases[] must not carry a placeholder backward");
    assert.deepEqual(keys.sort(), ["goto", "index", "when_summary"]);
  });
});

describe("graph-v1 — summarizeWhen", () => {
  it("renders a single rule", () => {
    assert.equal(
      summarizeWhen({ field: "{x.y}", op: "eq", value: 42 }),
      "{x.y} eq 42",
    );
  });

  it("renders implicit AND from an array", () => {
    assert.equal(
      summarizeWhen([
        { field: "a", op: "gt", value: 0 },
        { field: "b", op: "lt", value: 10 },
      ]),
      "a gt 0 AND b lt 10",
    );
  });

  it("renders all/any/not combinators", () => {
    assert.equal(
      summarizeWhen({
        all: [
          { field: "a", op: "gt", value: 0 },
          { any: [{ field: "b", op: "eq", value: 1 }, { field: "c", op: "eq", value: 2 }] },
        ],
      }),
      "(a gt 0 AND (b eq 1 OR c eq 2))",
    );
    assert.equal(
      summarizeWhen({ not: { field: "x", op: "eq", value: 0 } }),
      "NOT x eq 0",
    );
  });

  it("quotes string values and stringifies objects", () => {
    assert.equal(
      summarizeWhen({ field: "kind", op: "eq", value: "structured" }),
      'kind eq "structured"',
    );
  });
});
