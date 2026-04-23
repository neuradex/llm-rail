import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateWorkflowV1Def } from "../src/engine/workflow-v1.js";
import { isV1Workflow, V1_FORMAT_MARKER } from "../src/types-v1.js";
import type { WorkflowV1Def } from "../src/types-v1.js";
import { loadWorkflowFromPath } from "../src/engine/workflow.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function baseV1(overrides: Partial<WorkflowV1Def> = {}): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name: "test",
    schemas: {
      Input: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      Output: { type: "object", properties: { r: { type: "string" } }, required: ["r"] },
    },
    input: "Input",
    output: "Output",
    steps: [
      {
        id: "s1",
        type: "agentic",
        instruction: "do it",
        required_output: "Output",
      },
    ],
    ...overrides,
  };
}

describe("isV1Workflow", () => {
  it("recognizes a v1 marker", () => {
    assert.ok(isV1Workflow({ format: "v1", name: "x" }));
  });
  it("rejects non-object and missing marker", () => {
    assert.ok(!isV1Workflow(null));
    assert.ok(!isV1Workflow({}));
    assert.ok(!isV1Workflow({ format: "v2" }));
  });
});

describe("validateWorkflowV1Def — baseline", () => {
  it("accepts a minimal valid workflow", () => {
    const errors = validateWorkflowV1Def(baseV1());
    assert.deepEqual(errors, []);
  });

  it("rejects missing name / schemas / input / output", () => {
    const e1 = validateWorkflowV1Def(baseV1({ name: "" }));
    assert.ok(e1.some((e) => e.includes("Workflow must have a name")));

    const e2 = validateWorkflowV1Def(baseV1({ schemas: undefined as never }));
    assert.ok(e2.some((e) => e.includes("'schemas' block")));

    const e3 = validateWorkflowV1Def(baseV1({ input: undefined as never }));
    assert.ok(e3.some((e) => e.includes("must declare 'input'")));

    const e4 = validateWorkflowV1Def(baseV1({ output: undefined as never }));
    assert.ok(e4.some((e) => e.includes("must declare 'output'")));
  });

  it("flags input/output referencing unknown schemas", () => {
    const errors = validateWorkflowV1Def(
      baseV1({ input: "Missing", output: "AlsoMissing" }),
    );
    assert.ok(errors.some((e) => e.includes("input references unknown schema 'Missing'")));
    assert.ok(errors.some((e) => e.includes("output references unknown schema 'AlsoMissing'")));
  });

  it("rejects reserved workflow names", () => {
    const errors = validateWorkflowV1Def(baseV1({ name: "help" }));
    assert.ok(errors.some((e) => e.includes("reserved")));
  });

  it("rejects empty steps array", () => {
    const errors = validateWorkflowV1Def(baseV1({ steps: [] }));
    assert.ok(errors.some((e) => e.includes("at least one step")));
  });

  it("flags duplicate step ids", () => {
    const errors = validateWorkflowV1Def(
      baseV1({
        steps: [
          { id: "s1", type: "agentic", instruction: "a", required_output: "Output" },
          { id: "s1", type: "agentic", instruction: "b", required_output: "Output" },
        ],
      }),
    );
    assert.ok(errors.some((e) => e.includes("Duplicate step id: s1")));
  });

  it("rejects invalid max_depth", () => {
    const errors = validateWorkflowV1Def(baseV1({ max_depth: 0 }));
    assert.ok(errors.some((e) => e.includes("max_depth")));
  });
});

describe("validateWorkflowV1Def — agentic step", () => {
  it("requires instruction and required_output", () => {
    const errors = validateWorkflowV1Def(
      baseV1({
        steps: [
          { id: "s1", type: "agentic", instruction: "", required_output: "" as never },
        ],
      }),
    );
    assert.ok(errors.some((e) => e.includes("instruction")));
    assert.ok(errors.some((e) => e.includes("required_output")));
  });

  it("flags required_output referencing unknown schema", () => {
    const errors = validateWorkflowV1Def(
      baseV1({
        steps: [
          { id: "s1", type: "agentic", instruction: "do", required_output: "Ghost" },
        ],
      }),
    );
    assert.ok(errors.some((e) => e.includes("unknown schema 'Ghost'")));
  });
});

describe("validateWorkflowV1Def — programmatic step", () => {
  it("requires name and description on each action", () => {
    const errors = validateWorkflowV1Def(
      baseV1({
        steps: [
          {
            id: "s1",
            type: "programmatic",
            actions: [
              {
                name: "",
                description: "",
                js: "return { r: 'x' };",
              },
            ],
            required_output: "Output",
          },
        ],
      }),
    );
    assert.ok(errors.some((e) => e.includes("must have a non-empty 'name'")));
    assert.ok(errors.some((e) => e.includes("must have a non-empty 'description'")));
  });

  it("rejects lrail.set / lrail.get / lrail.goto in v1 js actions", () => {
    const errors = validateWorkflowV1Def(
      baseV1({
        steps: [
          {
            id: "s1",
            type: "programmatic",
            actions: [
              {
                name: "bad",
                description: "uses forbidden primitive",
                js: "lrail.set({ a: 1 }); return { r: 'x' };",
              },
            ],
            required_output: "Output",
          },
        ],
      }),
    );
    assert.ok(
      errors.some((e) => e.includes("lrail.get/set/goto")),
      `got: ${errors.join(" | ")}`,
    );
  });

  it("rejects actions with both js and shell", () => {
    const errors = validateWorkflowV1Def(
      baseV1({
        steps: [
          {
            id: "s1",
            type: "programmatic",
            actions: [
              {
                name: "x",
                description: "x",
                js: "return {};",
                shell: "echo hi",
              },
            ],
            required_output: "Output",
          },
        ],
      }),
    );
    assert.ok(errors.some((e) => e.includes("exactly one of 'js' or 'shell'")));
  });
});

describe("validateWorkflowV1Def — router step", () => {
  it("accepts a well-formed router", () => {
    const def = baseV1({
      steps: [
        {
          id: "s1",
          type: "agentic",
          instruction: "do",
          required_output: "Output",
        },
        {
          id: "r",
          type: "router",
          cases: [
            {
              when: { field: "{s1.r}", op: "eq", value: "x" },
              goto: "s1",
            },
          ],
          default: "s1",
          max_iterations: 10,
        },
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.deepEqual(errors, []);
  });

  it("rejects router without default", () => {
    const def = baseV1({
      steps: [
        {
          id: "s1",
          type: "agentic",
          instruction: "do",
          required_output: "Output",
        },
        {
          id: "r",
          type: "router",
          cases: [
            {
              when: { field: "{s1.r}", op: "eq", value: "x" },
              goto: "s1",
            },
          ],
        } as never,
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.ok(errors.some((e) => e.includes("must have 'default'")));
  });

  it("rejects goto targets that don't exist", () => {
    const def = baseV1({
      steps: [
        { id: "s1", type: "agentic", instruction: "d", required_output: "Output" },
        {
          id: "r",
          type: "router",
          cases: [
            { when: { field: "{s1.r}", op: "eq", value: "x" }, goto: "nowhere" },
          ],
          default: "also_nowhere",
        },
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.ok(errors.some((e) => e.includes("goto references unknown step 'nowhere'")));
    assert.ok(errors.some((e) => e.includes("default references unknown step 'also_nowhere'")));
  });
});

describe("validateWorkflowV1Def — call step", () => {
  it("accepts a call with simple references", () => {
    const def = baseV1({
      steps: [
        { id: "s1", type: "agentic", instruction: "d", required_output: "Output" },
        {
          id: "c",
          type: "call",
          workflow: "other",
          inputs: {
            q: "{s1.r}",
            other: "{{q}}",
          },
        },
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.deepEqual(errors, []);
  });

  it("rejects non-string inputs", () => {
    const def = baseV1({
      steps: [
        {
          id: "c",
          type: "call",
          workflow: "other",
          inputs: {
            q: { complex: "expr" } as unknown as string,
          },
        },
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.ok(
      errors.some((e) => e.includes("must be a reference string")),
    );
  });

  it("rejects call missing workflow or inputs", () => {
    const def = baseV1({
      steps: [
        { id: "c", type: "call" } as never,
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.ok(errors.some((e) => e.includes("must have 'workflow'")));
    assert.ok(errors.some((e) => e.includes("must have 'inputs'")));
  });
});

describe("validateWorkflowV1Def — context_in", () => {
  it("accepts valid step and param references", () => {
    const def = baseV1({
      steps: [
        { id: "s1", type: "agentic", instruction: "d", required_output: "Output" },
        {
          id: "s2",
          type: "agentic",
          instruction: "d",
          required_output: "Output",
          context_in: {
            from_step: "{s1.r}",
            from_param: "{{q}}",
          },
        },
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.deepEqual(errors, []);
  });

  it("flags references to unknown steps", () => {
    const def = baseV1({
      steps: [
        {
          id: "s1",
          type: "agentic",
          instruction: "d",
          required_output: "Output",
          context_in: { x: "{ghost.y}" },
        },
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.ok(errors.some((e) => e.includes("unknown step 'ghost'")));
  });

  it("rejects malformed reference templates", () => {
    const def = baseV1({
      steps: [
        {
          id: "s1",
          type: "agentic",
          instruction: "d",
          required_output: "Output",
          context_in: { x: "not-a-template" },
        },
      ],
    });
    const errors = validateWorkflowV1Def(def);
    assert.ok(errors.some((e) => e.includes("malformed reference")));
  });
});

describe("legacy loader guard", () => {
  it("rejects v1 files loaded via loadWorkflowFromPath", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-v1-"));
    const file = path.join(dir, "w.yml");
    fs.writeFileSync(
      file,
      [
        "format: v1",
        "name: wf",
        "schemas:",
        "  Input: { type: object }",
        "  Output: { type: object }",
        "input: Input",
        "output: Output",
        "steps:",
        "  - id: s1",
        "    type: agentic",
        "    instruction: x",
        "    required_output: Output",
      ].join("\n"),
    );
    assert.throws(
      () => loadWorkflowFromPath(file),
      /v1 workflow/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
