import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowDef } from "../src/types.js";
import { migrateLegacyWorkflow } from "../src/engine/migrate-v1.js";
import { validateWorkflowV1Def } from "../src/engine/workflow-v1.js";

describe("migrate-v1 — params → Input schema", () => {
  it("converts params into an Input schema with required and defaults", () => {
    const legacy: WorkflowDef = {
      name: "w",
      params: {
        url: { type: "string", required: true, description: "source" },
        limit: { type: "number", default: 10 },
      },
      steps: [
        { id: "s", instruction: "do", required_output: ["result"] },
      ],
    };
    const { migrated } = migrateLegacyWorkflow(legacy);
    assert.equal(migrated.input, "Input");
    const input = migrated.schemas.Input;
    assert.equal(input.type, "object");
    assert.deepEqual(input.required, ["url"]);
    assert.equal(input.properties?.url && typeof input.properties.url === "object" ? input.properties.url.type : undefined, "string");
    assert.equal(input.properties?.limit && typeof input.properties.limit === "object" ? input.properties.limit.type : undefined, "number");
  });

  it("produces an empty Input schema when no params", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [{ id: "s", instruction: "do", required_output: ["r"] }],
    };
    const { migrated } = migrateLegacyWorkflow(legacy);
    assert.equal(migrated.schemas.Input.type, "object");
    assert.equal(migrated.schemas.Input.properties, undefined);
  });
});

describe("migrate-v1 — required_output → step schemas", () => {
  it("creates a schema per step and wires required_output to its name", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [
        { id: "fetch-raw", instruction: "fetch", required_output: ["data", "count"] },
        { id: "transform", instruction: "transform", required_output: ["result"] },
      ],
    };
    const { migrated } = migrateLegacyWorkflow(legacy);

    const fetchStep = migrated.steps[0];
    const transformStep = migrated.steps[1];
    assert.equal(fetchStep.type, "agentic");
    if (fetchStep.type !== "agentic") throw new Error("type");
    assert.equal(fetchStep.required_output, "FetchRawOutput");

    if (transformStep.type !== "agentic") throw new Error("type");
    assert.equal(transformStep.required_output, "TransformOutput");

    assert.ok(migrated.schemas.FetchRawOutput.required?.includes("data"));
    assert.ok(migrated.schemas.FetchRawOutput.required?.includes("count"));
    assert.ok(migrated.schemas.TransformOutput.required?.includes("result"));
  });

  it("folds structural validation rules into the step's schema", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [
        {
          id: "s",
          instruction: "do",
          required_output: ["items", "mode"],
          validation: [
            { field: "items", op: "type", value: "array" },
            { field: "items", op: "min_length", value: 1 },
            { field: "mode", op: "one_of", value: ["a", "b"] },
          ],
        },
      ],
    };
    const { migrated } = migrateLegacyWorkflow(legacy);
    const schema = migrated.schemas.SOutput;
    const items = schema.properties?.items as { type?: string; minItems?: number };
    const mode = schema.properties?.mode as { enum?: string[] };
    assert.equal(items.type, "array");
    assert.equal(items.minItems, 1);
    assert.deepEqual(mode.enum, ["a", "b"]);
  });

  it("preserves non-structural validation rules on the step", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [
        {
          id: "s",
          instruction: "do",
          required_output: ["data"],
          validation: [
            { field: "data", op: "type", value: "array" },
            { field: "data", op: "script", value: "exit 0" },
          ],
        },
      ],
    };
    const { migrated, todos } = migrateLegacyWorkflow(legacy);
    const step = migrated.steps[0];
    if (step.type !== "agentic") throw new Error("type");
    assert.ok(step.validation?.some((r) => r.op === "script"));
    assert.ok(todos.some((t) => t.includes("non-structural")));
  });
});

describe("migrate-v1 — last step → Output", () => {
  it("uses the last step's output schema as the workflow output", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [
        { id: "a", instruction: "a", required_output: ["x"] },
        { id: "b", instruction: "b", required_output: ["y"] },
      ],
    };
    const { migrated } = migrateLegacyWorkflow(legacy);
    assert.equal(migrated.output, "BOutput");
  });
});

describe("migrate-v1 — actions name/description", () => {
  it("injects default name and description when missing", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [
        {
          id: "s",
          type: "programmatic",
          required_output: ["out"],
          actions: [
            { js: "return { out: 1 };" } as never,
          ],
        },
      ],
    };
    const { migrated } = migrateLegacyWorkflow(legacy);
    const step = migrated.steps[0];
    if (step.type !== "programmatic") throw new Error("type");
    assert.equal(step.actions[0].name, "action1");
    assert.ok(step.actions[0].description.includes("TODO"));
  });
});

describe("migrate-v1 — detections (TODOs)", () => {
  it("flags lrail.set / lrail.get / lrail.goto usage in JS actions", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [
        {
          id: "s",
          type: "programmatic",
          required_output: ["out"],
          actions: [
            { js: "lrail.set({ a: 1 }); return { out: lrail.get('a') };" } as never,
          ],
        },
      ],
    };
    const { todos } = migrateLegacyWorkflow(legacy);
    assert.ok(todos.some((t) => t.includes("lrail.set") || t.includes("set —")), todos.join("\n"));
  });

  it("flags accumulate usage", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [
        {
          id: "s",
          instruction: "do",
          required_output: ["items"],
          accumulate: { items: { key: "id" } },
        },
      ],
    };
    const { todos } = migrateLegacyWorkflow(legacy);
    assert.ok(todos.some((t) => t.includes("accumulate")));
  });
});

describe("migrate-v1 — tips", () => {
  it("folds tips into the instruction and does not carry them to v1", () => {
    const legacy: WorkflowDef = {
      name: "w",
      steps: [
        {
          id: "s",
          instruction: "do the thing",
          required_output: ["r"],
          tips: ["use the fast path", "don't forget to close the socket"],
        },
      ],
    };
    const { migrated } = migrateLegacyWorkflow(legacy);
    const step = migrated.steps[0];
    if (step.type !== "agentic") throw new Error("type");
    assert.ok(step.instruction.includes("use the fast path"));
    assert.ok(step.instruction.includes("close the socket"));
    assert.equal((step as unknown as { tips?: unknown }).tips, undefined);
  });
});

describe("migrate-v1 — output round-trip validity", () => {
  it("a migrated declarative workflow passes validateWorkflowV1Def", () => {
    const legacy: WorkflowDef = {
      name: "pipeline",
      params: {
        source: { type: "string", required: true },
      },
      steps: [
        {
          id: "fetch",
          instruction: "{{source}} 에서 수집",
          required_output: ["items"],
          validation: [
            { field: "items", op: "type", value: "array" },
            { field: "items", op: "min_length", value: 1 },
          ],
        },
        {
          id: "shape",
          type: "programmatic",
          context_in: { items: "{fetch.items}" },
          required_output: ["shaped"],
          actions: [
            { js: "return { shaped: context.items.map(x => x) };" } as never,
          ],
        },
      ],
    };
    const { migrated } = migrateLegacyWorkflow(legacy);
    const errors = validateWorkflowV1Def(migrated);
    assert.deepEqual(errors, []);
  });
});
