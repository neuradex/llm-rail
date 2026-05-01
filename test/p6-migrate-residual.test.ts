import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrateLegacyWorkflow } from "../src/engine/migrate-v1.js";
import { validateWorkflowV1Def } from "../src/engine/workflow-v1.js";
import type { WorkflowDef } from "../src/types.js";

const baseLegacy = (overrides: Partial<WorkflowDef>): WorkflowDef => ({
  name: "lg",
  steps: [],
  ...overrides,
});

// ── structural fold for every op ──

describe("migrate — structural validation ops fold into schema", () => {
  it("type / min_length / max_length / length / min / max / one_of / not_empty all fold", () => {
    const { migrated } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "s1",
        type: "agentic",
        instruction: "do",
        required_output: ["a", "b", "c", "d"],
        validation: [
          { field: "a", op: "type", value: "string" },
          { field: "a", op: "min_length", value: 2 },
          { field: "a", op: "max_length", value: 10 },
          { field: "b", op: "type", value: "array" },
          { field: "b", op: "length", value: 3 },
          { field: "c", op: "type", value: "integer" },
          { field: "c", op: "min", value: 0 },
          { field: "c", op: "max", value: 100 },
          { field: "d", op: "one_of", value: ["x", "y", "z"] },
        ],
      }],
    }));
    const sch = migrated.schemas.S1Output;
    assert.equal(sch.properties?.a && typeof sch.properties.a !== "string" ? sch.properties.a.minLength : null, 2);
    assert.equal(sch.properties?.a && typeof sch.properties.a !== "string" ? sch.properties.a.maxLength : null, 10);
    const b = sch.properties?.b;
    assert.equal(b && typeof b !== "string" ? b.minItems : null, 3);
    assert.equal(b && typeof b !== "string" ? b.maxItems : null, 3);
    const c = sch.properties?.c;
    assert.equal(c && typeof c !== "string" ? c.minimum : null, 0);
    assert.equal(c && typeof c !== "string" ? c.maximum : null, 100);
    const d = sch.properties?.d;
    assert.deepEqual(d && typeof d !== "string" ? d.enum : null, ["x", "y", "z"]);
  });

  it("not_empty on string folds to minLength: 1", () => {
    const { migrated } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "s",
        type: "agentic",
        instruction: "do",
        required_output: ["v"],
        validation: [
          { field: "v", op: "type", value: "string" },
          { field: "v", op: "not_empty" },
        ],
      }],
    }));
    const v = migrated.schemas.SOutput.properties?.v;
    assert.equal(v && typeof v !== "string" ? v.minLength : null, 1);
  });
});

// ── non-structural preserved as v1 validation ──

describe("migrate — non-structural rules preserved as v1 validation", () => {
  it("script + verify_source survive, with a TODO flag for review", () => {
    const { migrated, todos } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "s",
        type: "agentic",
        instruction: "do",
        required_output: ["v"],
        validation: [
          { field: "v", op: "script", value: "true" },
          { field: "v", op: "verify_source", value: { url_field: "u", field_snippets: { v: "snip" } } },
        ],
      }],
    }));
    const step = migrated.steps[0];
    assert.equal(step.type, "agentic");
    assert.ok((step as { validation?: unknown[] }).validation);
    const rules = (step as { validation: { op: string }[] }).validation;
    const ops = rules.map((r) => r.op).sort();
    assert.deepEqual(ops, ["script", "verify_source"]);
    assert.ok(
      todos.some((t) => /non-structural validation rules preserved/i.test(t)),
      todos.join(" | "),
    );
  });
});

// ── assertions preserved ──

describe("migrate — assertions preserved verbatim", () => {
  it("legacy assertions[] copied to v1 step.assertions without folding", () => {
    const { migrated } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "s",
        type: "agentic",
        instruction: "do",
        required_output: ["v"],
        assertions: [
          { field: "v", op: "min", value: 10 },
        ],
      }],
    }));
    const step = migrated.steps[0] as { assertions?: { op: string; value: unknown }[] };
    assert.ok(step.assertions);
    assert.equal(step.assertions[0].op, "min");
    assert.equal(step.assertions[0].value, 10);
  });
});

// ── context_in / timeout_ms / meta preserved ──

describe("migrate — auxiliary fields preserved", () => {
  it("context_in / timeout_ms / meta / description carry over", () => {
    const { migrated } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "s",
        type: "agentic",
        description: "d",
        instruction: "do",
        required_output: ["v"],
        context_in: { x: "{prev.f}" },
        timeout_ms: 12345,
        meta: { tag: "alpha" },
      }],
    }));
    const step = migrated.steps[0] as {
      description?: string;
      context_in?: Record<string, unknown>;
      timeout_ms?: number;
      meta?: Record<string, unknown>;
    };
    assert.equal(step.description, "d");
    assert.deepEqual(step.context_in, { x: "{prev.f}" });
    assert.equal(step.timeout_ms, 12345);
    assert.deepEqual(step.meta, { tag: "alpha" });
  });
});

// ── workflow-level: phase / version / description / policy ──

describe("migrate — workflow-level fields propagate", () => {
  it("phase / version / description / policy carry to v1", () => {
    const { migrated } = migrateLegacyWorkflow(baseLegacy({
      version: "0.7.3",
      description: "legacy desc",
      phase: "dev",
      policy: { mode: "trail" },
      steps: [{
        id: "s",
        type: "programmatic",
        actions: [{ js: "return { v: 1 };" } as never],
        required_output: ["v"],
      }],
    }));
    assert.equal(migrated.version, "0.7.3");
    assert.equal(migrated.description, "legacy desc");
    assert.equal(migrated.phase, "dev");
    assert.deepEqual(migrated.policy, { mode: "trail" });
  });
});

// ── tools block produces a TODO ──

describe("migrate — tools block flagged for manual review", () => {
  it("emits a TODO note for tools and keeps the tools field on the migrated def", () => {
    const { migrated, todos } = migrateLegacyWorkflow(baseLegacy({
      tools: {
        search: { actions: [{ js: "return {};" } as never] },
      },
      steps: [{
        id: "s",
        type: "agentic",
        instruction: "do",
        required_output: ["v"],
      }],
    }));
    assert.ok(todos.some((t) => /tools/i.test(t)));
    assert.ok(migrated.tools && migrated.tools.search);
  });
});

// ── empty actions array → TODO ──

describe("migrate — programmatic step with empty actions", () => {
  it("flags 'no actions after migration' as a TODO", () => {
    const { todos } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "p",
        type: "programmatic",
        actions: [],
        required_output: ["v"],
      }],
    }));
    assert.ok(todos.some((t) => /no actions after migration/.test(t)));
  });
});

// ── No required_output anywhere → empty Output stub + TODO ──

describe("migrate — no required_output in any step", () => {
  it("creates an empty Output schema and emits a TODO to define output", () => {
    const { migrated, todos } = migrateLegacyWorkflow(baseLegacy({
      steps: [
        { id: "a", type: "programmatic", actions: [{ js: "return {};" } as never] },
        { id: "b", type: "agentic", instruction: "do" },
      ],
    }));
    assert.equal(migrated.output, "Output");
    assert.deepEqual(migrated.schemas.Output, { type: "object" });
    assert.ok(todos.some((t) => /Define output/i.test(t)));
  });
});

// ── lrail.set/get/goto detection (each variant) ──

describe("migrate — imperative-API detection fine-grained", () => {
  it("lrail.goto produces a goto-flagged TODO", () => {
    const { todos } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "p",
        type: "programmatic",
        actions: [{ js: "lrail.goto('start');" } as never],
        required_output: ["v"],
      }],
    }));
    assert.ok(todos.some((t) => /lrail\.goto/.test(t)));
  });

  it("lrail.set produces a set-flagged TODO", () => {
    const { todos } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "p",
        type: "programmatic",
        actions: [{ js: "lrail.set('k', 1);" } as never],
        required_output: ["v"],
      }],
    }));
    assert.ok(todos.some((t) => /lrail\.set/.test(t)));
  });

  it("lrail.get produces a get-flagged TODO", () => {
    const { todos } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "p",
        type: "programmatic",
        actions: [{ js: "const x = lrail.get('k');" } as never],
        required_output: ["v"],
      }],
    }));
    assert.ok(todos.some((t) => /lrail\.get/.test(t)));
  });
});

// ── auto-action name + description placeholder ──

describe("migrate — synthesized action name/description", () => {
  it("uses 'actionN' and a TODO description when both are missing", () => {
    const { migrated, todos } = migrateLegacyWorkflow(baseLegacy({
      steps: [{
        id: "p",
        type: "programmatic",
        required_output: ["v"],
        actions: [
          { js: "return { v: 1 };" } as never,
          { shell: "echo {}" } as never,
        ],
      }],
    }));
    const step = migrated.steps[0] as { actions: { name: string; description: string }[] };
    assert.equal(step.actions[0].name, "action1");
    assert.equal(step.actions[1].name, "action2");
    assert.match(step.actions[0].description, /TODO/);
    void todos;
  });
});

// ── full roundtrip retained by validateWorkflowV1Def ──

describe("migrate — output roundtrip through validation (residual)", () => {
  it("a migrated workflow with all simple features validates", () => {
    const { migrated } = migrateLegacyWorkflow(baseLegacy({
      version: "0.0.1",
      description: "demo",
      phase: "draft",
      params: {
        mode: { type: "string", required: true },
        n: { type: "number", default: 0, required: false },
      },
      steps: [
        {
          id: "compute",
          type: "programmatic",
          context_in: { mode: "{{mode}}", n: "{{n}}" },
          required_output: ["v"],
          validation: [{ field: "v", op: "type", value: "integer" }],
          actions: [{ name: "do", description: "compute", js: "return { v: 1 };" }] as never,
        },
        {
          id: "ask",
          type: "agentic",
          instruction: "produce final",
          required_output: ["label"],
          validation: [{ field: "label", op: "type", value: "string" }],
          context_in: { v: "{compute.v}" },
        },
      ],
    }));
    const errs = validateWorkflowV1Def(migrated);
    assert.deepEqual(errs, [], `unexpected validation errors: ${errs.join(" | ")}`);
  });
});
