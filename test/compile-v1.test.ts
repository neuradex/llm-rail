import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import { compileV1Workflow } from "../src/engine/compile-v1.js";
import { makeInMemoryRegistry } from "../src/engine/call-v1.js";

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

describe("compile-v1 — structural baseline", () => {
  it("passes a valid single-step workflow with no diagnostics", () => {
    const def = mkDef("ok", {
      steps: [
        {
          id: "s1",
          type: "agentic",
          instruction: "do",
          required_output: "Output",
        },
      ],
    });
    const r = compileV1Workflow(def);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  });

  it("short-circuits deeper checks if structure already failed", () => {
    const def = mkDef("", {
      steps: [
        {
          id: "s1",
          type: "agentic",
          instruction: "",
          required_output: "Output",
        },
      ],
    });
    const r = compileV1Workflow(def);
    // structure errors only
    assert.ok(r.errors.length > 0);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.info, []);
  });
});

describe("compile-v1 — schema cycles", () => {
  it("surfaces recursive schemas as info", () => {
    const def = mkDef("rec", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Tree: {
          type: "object",
          properties: {
            v: { type: "integer" },
            children: { type: "array", items: "Tree" },
          },
        },
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
    const r = compileV1Workflow(def);
    assert.deepEqual(r.errors, []);
    assert.ok(r.info.some((i) => i.includes("Tree")));
  });
});

describe("compile-v1 — context_in execution order", () => {
  it("warns when a step references a later step without a default", () => {
    const def = mkDef("ooo", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "early",
          type: "programmatic",
          context_in: { v: "{late.v}" },
          required_output: "R",
          actions: [
            { name: "use", description: "read later", js: "return { v: 0 };" },
          ],
        },
        {
          id: "late",
          type: "programmatic",
          required_output: "R",
          actions: [
            { name: "seed", description: "seed", js: "return { v: 1 };" },
          ],
        },
      ],
    });
    const r = compileV1Workflow(def);
    assert.deepEqual(r.errors, []);
    assert.ok(
      r.warnings.some((w) => w.includes("at or after") && w.includes("early")),
      r.warnings.join(" | "),
    );
  });

  it("does not warn when forward reference has a default", () => {
    const def = mkDef("ooo", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "early",
          type: "programmatic",
          context_in: { v: { from: "{late.v}", default: null } },
          required_output: "R",
          actions: [
            { name: "use", description: "use", js: "return { v: 0 };" },
          ],
        },
        {
          id: "late",
          type: "programmatic",
          required_output: "R",
          actions: [
            { name: "seed", description: "seed", js: "return { v: 1 };" },
          ],
        },
      ],
    });
    const r = compileV1Workflow(def);
    assert.deepEqual(r.warnings, []);
  });
});

describe("compile-v1 — router max_iterations", () => {
  it("errors when a backward goto exists but max_iterations is missing", () => {
    const def = mkDef("loop", {
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
          actions: [
            { name: "s", description: "seed", js: "return { v: 1 };" },
          ],
        },
        {
          id: "r",
          type: "router",
          cases: [
            { when: { field: "{seed.v}", op: "gt", value: 100 }, goto: "end" },
          ],
          default: "seed", // backward
        },
        {
          id: "end",
          type: "programmatic",
          required_output: "R",
          actions: [
            { name: "e", description: "end", js: "return { v: 1 };" },
          ],
        },
      ],
    });
    const r = compileV1Workflow(def);
    assert.ok(r.errors.some((e) => e.includes("max_iterations")));
  });

  it("accepts backward goto when max_iterations is declared", () => {
    const def = mkDef("loop", {
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
          actions: [
            { name: "s", description: "seed", js: "return { v: 1 };" },
          ],
        },
        {
          id: "r",
          type: "router",
          cases: [
            { when: { field: "{seed.v}", op: "gt", value: 100 }, goto: "end" },
          ],
          default: "seed",
          max_iterations: 50,
        },
        {
          id: "end",
          type: "programmatic",
          required_output: "R",
          actions: [
            { name: "e", description: "end", js: "return { v: 1 };" },
          ],
        },
      ],
    });
    const r = compileV1Workflow(def);
    assert.deepEqual(r.errors, []);
  });

  it("does not require max_iterations for pure forward routers", () => {
    const def = mkDef("forward", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
      },
      steps: [
        {
          id: "r",
          type: "router",
          cases: [{ when: { field: "{{x}}", op: "eq", value: "a" }, goto: "a" }],
          default: "b",
        },
        {
          id: "a",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "a", js: "return { v: 1 };" }],
        },
        {
          id: "b",
          type: "programmatic",
          required_output: "R",
          actions: [{ name: "x", description: "b", js: "return { v: 2 };" }],
        },
      ],
    });
    const r = compileV1Workflow(def);
    assert.deepEqual(r.errors, []);
  });
});

describe("compile-v1 — self recursion", () => {
  it("errors when a workflow calls itself without max_depth", () => {
    const def = mkDef("rec", {
      steps: [
        { id: "c", type: "call", workflow: "rec", inputs: {} },
      ],
    });
    const r = compileV1Workflow(def);
    assert.ok(r.errors.some((e) => e.includes("max_depth")));
  });

  it("accepts self-recursion when max_depth is declared", () => {
    const def = mkDef("rec", {
      max_depth: 10,
      steps: [
        { id: "c", type: "call", workflow: "rec", inputs: {} },
      ],
    });
    const r = compileV1Workflow(def);
    assert.deepEqual(r.errors, []);
  });
});

describe("compile-v1 — cross-workflow IO (with registry)", () => {
  it("errors when call is missing a required input of the child", () => {
    const child = mkDef("helper", {
      schemas: {
        Input: {
          type: "object",
          properties: { n: { type: "integer" } },
          required: ["n"],
        },
        Output: { type: "object" },
      },
      steps: [
        {
          id: "x",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return {};" }],
        },
      ],
    });

    const parent = mkDef("p", {
      steps: [
        { id: "call-h", type: "call", workflow: "helper", inputs: {} },
      ],
    });
    const r = compileV1Workflow(parent, makeInMemoryRegistry({ helper: child, p: parent }));
    assert.ok(
      r.errors.some((e) => e.includes("missing required input 'n'")),
      r.errors.join(" | "),
    );
  });

  it("warns when call inputs include a field not declared in child's input schema", () => {
    const child = mkDef("helper", {
      schemas: {
        Input: {
          type: "object",
          properties: { n: { type: "integer" } },
          required: ["n"],
        },
        Output: { type: "object" },
      },
      steps: [
        {
          id: "x",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return {};" }],
        },
      ],
    });

    const parent = mkDef("p", {
      schemas: {
        Input: {
          type: "object",
          properties: { n: { type: "integer" } },
          required: ["n"],
        },
        Output: { type: "object" },
      },
      steps: [
        {
          id: "call-h",
          type: "call",
          workflow: "helper",
          inputs: { n: "{{n}}", bogus: "{{n}}" },
        },
      ],
    });
    const r = compileV1Workflow(parent, makeInMemoryRegistry({ helper: child, p: parent }));
    assert.deepEqual(r.errors, []);
    assert.ok(
      r.warnings.some((w) => w.includes("bogus") && w.includes("not declared")),
      r.warnings.join(" | "),
    );
  });

  it("warns when a downstream reference names an undeclared child output field", () => {
    const child = mkDef("helper", {
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
          id: "x",
          type: "programmatic",
          required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return { result: 'ok' };" }],
        },
      ],
    });

    const parent = mkDef("p", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        Done: { type: "object", properties: { out: { type: "string" } }, required: ["out"] },
      },
      steps: [
        { id: "call-h", type: "call", workflow: "helper", inputs: {} },
        {
          id: "use",
          type: "programmatic",
          context_in: { out: "{call-h.missing_field}" },
          required_output: "Done",
          actions: [
            { name: "x", description: "use", js: "return { out: context.out };" },
          ],
        },
      ],
    });
    const r = compileV1Workflow(parent, makeInMemoryRegistry({ helper: child, p: parent }));
    assert.ok(
      r.warnings.some((w) => w.includes("missing_field")),
      r.warnings.join(" | "),
    );
  });

  it("detects transitive recursion and requires max_depth", () => {
    const a = mkDef("a", {
      steps: [{ id: "to-b", type: "call", workflow: "b", inputs: {} }],
    });
    const b = mkDef("b", {
      steps: [{ id: "to-a", type: "call", workflow: "a", inputs: {} }],
    });
    const registry = makeInMemoryRegistry({ a, b });
    const r = compileV1Workflow(a, registry);
    assert.ok(
      r.errors.some((e) => e.includes("call cycle") || e.includes("transitive")),
      r.errors.join(" | "),
    );
  });
});

describe("compile-v1 — call.inputs forward reference", () => {
  it("warns when call.inputs references a step at or after the call step", () => {
    const child = mkDef("child", {
      schemas: {
        Input: {
          type: "object",
          properties: { x: { type: "integer" } },
          required: ["x"],
        },
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
    const parent = mkDef("p", {
      schemas: {
        Input: { type: "object" },
        Output: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
        Mid: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] },
      },
      steps: [
        // call references {later.x} — but later is after call → warning
        {
          id: "call-c",
          type: "call",
          workflow: "child",
          inputs: { x: "{later.x}" },
        },
        {
          id: "later",
          type: "programmatic",
          required_output: "Mid",
          actions: [{ name: "x", description: "x", js: "return { x: 1 };" }],
        },
      ],
    });
    const r = compileV1Workflow(parent, makeInMemoryRegistry({ p: parent, child }));
    assert.ok(
      r.warnings.some((w) => /Call step 'call-c' inputs\.x.*after/.test(w)),
      r.warnings.join(" | "),
    );
  });
});
