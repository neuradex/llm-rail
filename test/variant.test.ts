import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { WorkflowDef, VariantDef } from "../src/types.js";

// ── mergeVariant ──

describe("mergeVariant", () => {
  // We import dynamically to avoid module caching issues
  let mergeVariant: typeof import("../src/engine/variant.js").mergeVariant;

  before(async () => {
    const mod = await import("../src/engine/variant.js");
    mergeVariant = mod.mergeVariant;
  });

  const baseDef: WorkflowDef = {
    name: "test-wf",
    version: "1.0",
    description: "Base description",
    phase: "dev",
    params: {
      target: { type: "string", required: true },
      count: { type: "number", default: 10 },
    },
    context: { env: "production", region: "us" },
    steps: [
      {
        id: "collect",
        description: "Collect data",
        instruction: "Collect data",
        required_output: ["items"],
        validation: [
          { field: "items", op: "type", value: "array" },
          { field: "items", op: "min_length", value: 1 },
        ],
        tips: ["Use WebSearch", "Check sources"],
      },
      {
        id: "analyze",
        description: "Analyze data",
        instruction: "Analyze data",

        required_output: ["result", "score"],
      },
      {
        id: "report",
        description: "Generate report",
        instruction: "Generate report",

        required_output: ["summary"],
      },
    ],
    policy: { mode: "trail" },
  };

  it("overrides scalar fields (description)", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      description: "Variant description",
    };
    const merged = mergeVariant(baseDef, variant);
    assert.equal(merged.description, "Variant description");
    assert.equal(merged.name, "test-wf"); // name preserved
    assert.equal(merged.version, "1.0"); // version preserved
  });

  it("merges params (add + override)", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      params: {
        api_endpoint: { type: "string", required: true },
        count: { type: "number", default: 20 },
      },
    };
    const merged = mergeVariant(baseDef, variant);
    assert.ok(merged.params);
    // Original param preserved
    assert.equal(merged.params.target.type, "string");
    assert.equal(merged.params.target.required, true);
    // New param added
    assert.equal(merged.params.api_endpoint.type, "string");
    // Overridden param
    assert.equal(merged.params.count.default, 20);
  });

  it("overrides step by id (field-level override)", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      steps: [
        {
          id: "collect",
          type: "programmatic",
          actions: [{ run: "curl -s /api/items", extract: { items: "items" } }],
        },
      ],
    };
    const merged = mergeVariant(baseDef, variant);
    const collect = merged.steps.find((s) => s.id === "collect")!;
    // Overridden fields
    assert.equal(collect.type, "programmatic");
    assert.ok(collect.actions);
    assert.equal(collect.actions!.length, 1);
    // Inherited field from base
    assert.equal(collect.description, "Collect data");
    assert.deepEqual(collect.required_output, ["items"]);
  });

  it("replaces array fields in step (validation, tips, actions)", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      steps: [
        {
          id: "collect",
          validation: [{ field: "items", op: "min_length", value: 5 }],
          tips: ["Only one tip"],
        },
      ],
    };
    const merged = mergeVariant(baseDef, variant);
    const collect = merged.steps.find((s) => s.id === "collect")!;
    // Validation replaced, not concatenated
    assert.equal(collect.validation!.length, 1);
    assert.equal(collect.validation![0].value, 5);
    // Tips replaced, not concatenated
    assert.equal(collect.tips!.length, 1);
    assert.equal(collect.tips![0], "Only one tip");
  });

  it("adds new steps (new id appended)", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      steps: [
        {
          id: "extra-step",
          description: "Extra processing",
          instruction: "Extra processing",
  
          required_output: ["extra"],
        },
      ],
    };
    const merged = mergeVariant(baseDef, variant);
    assert.equal(merged.steps.length, 4); // 3 base + 1 new
    assert.equal(merged.steps[3].id, "extra-step");
  });

  it("preserves base steps not in variant", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      steps: [
        { id: "collect", description: "Override collect" },
      ],
    };
    const merged = mergeVariant(baseDef, variant);
    // analyze and report should be preserved
    assert.equal(merged.steps.length, 3);
    assert.equal(merged.steps[1].id, "analyze");
    assert.equal(merged.steps[1].description, "Analyze data");
    assert.equal(merged.steps[2].id, "report");
  });

  it("preserves base step order", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      steps: [
        { id: "report", description: "Override report" },
        { id: "collect", description: "Override collect" },
      ],
    };
    const merged = mergeVariant(baseDef, variant);
    // Order should follow base: collect, analyze, report
    assert.equal(merged.steps[0].id, "collect");
    assert.equal(merged.steps[0].description, "Override collect");
    assert.equal(merged.steps[1].id, "analyze");
    assert.equal(merged.steps[2].id, "report");
    assert.equal(merged.steps[2].description, "Override report");
  });

  it("replaces policy entirely", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      policy: {
        mode: "enforce",
        rules: [{ effect: "allow", commands: ["echo *"] }],
      },
    };
    const merged = mergeVariant(baseDef, variant);
    assert.equal(merged.policy!.mode, "enforce");
    assert.equal(merged.policy!.rules!.length, 1);
  });

  it("shallow merges context", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      context: { env: "staging", api_version: "v2" },
    };
    const merged = mergeVariant(baseDef, variant);
    assert.equal(merged.context!.env, "staging"); // overridden
    assert.equal(merged.context!.region, "us"); // preserved from base
    assert.equal(merged.context!.api_version, "v2"); // new
  });

  it("overrides phase", () => {
    const variant: VariantDef = {
      extends: "base",
      variant: "v1",
      phase: "draft",
    };
    const merged = mergeVariant(baseDef, variant);
    assert.equal(merged.phase, "draft");
  });
});

// ── resolveWorkflowPath / listVariants / loadVariant / loadWorkflow ──

describe("variant filesystem operations", () => {
  const testDir = path.resolve("test-variant-fs-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);

    // Directory format workflow
    fs.mkdirSync("workflows/dir-wf", { recursive: true });
    fs.writeFileSync(
      "workflows/dir-wf/workflow.yml",
      yaml.dump({
        name: "dir-wf",
        steps: [{ id: "s1", description: "Step 1", instruction: "Step 1", required_output: ["a"] }],
      }),
    );
    fs.writeFileSync(
      "workflows/dir-wf/fast.workflow.yml",
      yaml.dump({
        extends: "base",
        variant: "fast",
        description: "Fast variant",
        steps: [{ id: "s1", type: "programmatic", actions: [{ run: "echo ok" }] }],
      }),
    );

    // Single-file workflow
    fs.mkdirSync("workflows", { recursive: true });
    fs.writeFileSync(
      "workflows/single-wf.yml",
      yaml.dump({
        name: "single-wf",
        steps: [{ id: "s1", description: "Step 1", instruction: "Step 1", required_output: ["a"] }],
      }),
    );

    // Variant without extends
    fs.writeFileSync(
      "workflows/dir-wf/bad.workflow.yml",
      yaml.dump({ variant: "bad", steps: [] }),
    );
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("resolveWorkflowPath — directory format", async () => {
    const { resolveWorkflowPath } = await import("../src/engine/variant.js");
    const result = resolveWorkflowPath("dir-wf");
    assert.equal(result.isDirectory, true);
    assert.ok(result.basePath.endsWith("workflow.yml"));
  });

  it("resolveWorkflowPath — single file (backward compat)", async () => {
    const { resolveWorkflowPath } = await import("../src/engine/variant.js");
    const result = resolveWorkflowPath("single-wf");
    assert.equal(result.isDirectory, false);
    assert.ok(result.basePath.endsWith("single-wf.yml"));
  });

  it("resolveWorkflowPath — throws for missing workflow", async () => {
    const { resolveWorkflowPath } = await import("../src/engine/variant.js");
    assert.throws(() => resolveWorkflowPath("nonexistent"), /not found/);
  });

  it("listVariants — scans *.workflow.yml", async () => {
    const { listVariants } = await import("../src/engine/variant.js");
    const variants = listVariants("dir-wf");
    assert.ok(variants.includes("fast"));
    assert.ok(variants.includes("bad"));
    assert.ok(!variants.includes("workflow")); // workflow.yml excluded
  });

  it("listVariants — returns empty for single-file workflow", async () => {
    const { listVariants } = await import("../src/engine/variant.js");
    const variants = listVariants("single-wf");
    assert.equal(variants.length, 0);
  });

  it("loadVariant — loads and validates", async () => {
    const { loadVariant } = await import("../src/engine/variant.js");
    const v = loadVariant("dir-wf", "fast");
    assert.equal(v.extends, "base");
    assert.equal(v.variant, "fast");
    assert.equal(v.description, "Fast variant");
  });

  it("loadVariant — rejects missing extends", async () => {
    const { loadVariant } = await import("../src/engine/variant.js");
    assert.throws(() => loadVariant("dir-wf", "bad"), /extends: base/);
  });

  it("loadVariant — throws for nonexistent variant", async () => {
    const { loadVariant } = await import("../src/engine/variant.js");
    assert.throws(() => loadVariant("dir-wf", "nonexistent"), /not found/);
  });

  it("loadWorkflow with variant — returns merged result", async () => {
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const def = loadWorkflow("dir-wf", "fast");
    assert.equal(def.name, "dir-wf");
    assert.equal(def.description, "Fast variant");
    const s1 = def.steps.find((s) => s.id === "s1")!;
    assert.equal(s1.type, "programmatic");
  });

  it("loadWorkflow without variant — returns base", async () => {
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const def = loadWorkflow("dir-wf");
    assert.equal(def.name, "dir-wf");
    const s1 = def.steps.find((s) => s.id === "s1")!;
    assert.equal(s1.type, undefined); // default agentic
  });
});

// ── createInstance with variant ──

describe("createInstance with variant", () => {
  const testDir = path.resolve("test-variant-instance-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    fs.mkdirSync("workflows", { recursive: true });
    fs.writeFileSync(
      "workflows/vi-test.yml",
      yaml.dump({
        name: "vi-test",
        steps: [{ id: "s1", description: "Step 1", instruction: "Step 1", required_output: ["a"] }],
      }),
    );
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("records variant in state", async () => {
    const { createInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const def = loadWorkflow("vi-test");
    const state = createInstance(def, {}, "api-driven");
    assert.equal(state.variant, "api-driven");
    assert.equal(state.workflow_name, "vi-test");
  });

  it("omits variant field when not specified", async () => {
    const { createInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const def = loadWorkflow("vi-test");
    const state = createInstance(def, {});
    assert.equal(state.variant, undefined);
  });
});

// ── mergeVariantAnnotated ──

describe("mergeVariantAnnotated", () => {
  it("produces YAML with header comments", async () => {
    const { mergeVariantAnnotated } = await import("../src/engine/variant.js");
    const base: WorkflowDef = {
      name: "test",
      steps: [{ id: "s1", description: "Step 1", instruction: "Step 1", required_output: ["a"] }],
    };
    const variant: VariantDef = {
      extends: "base",
      variant: "fast",
      description: "Fast",
    };
    const result = mergeVariantAnnotated(base, variant);
    assert.ok(result.includes("# Merged: base + variant 'fast'"));
    assert.ok(result.includes("description: Fast"));
  });
});
