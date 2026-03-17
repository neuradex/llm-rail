import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { WorkflowDef, InstanceState } from "../src/types.js";
import { validateWorkflowDef } from "../src/engine/workflow.js";
import { validateStepOutput } from "../src/engine/validator.js";
import { pickTips } from "../src/engine/tip-pool.js";
import { generateId } from "../src/util.js";

describe("validateWorkflowDef", () => {
  it("accepts a valid workflow", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", description: "Step 1", required_output: ["a"] },
        { id: "s2", description: "Step 2", depends_on: "s1", required_output: ["b"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("rejects duplicate step IDs", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", description: "Step 1", required_output: ["a"] },
        { id: "s1", description: "Step 1 dup", required_output: ["b"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("Duplicate")));
  });

  it("rejects invalid depends_on reference", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", description: "Step 1", depends_on: "nonexistent", required_output: ["a"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("unknown step")));
  });

  it("detects cycles", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", description: "Step 1", depends_on: "s2", required_output: ["a"] },
        { id: "s2", description: "Step 2", depends_on: "s1", required_output: ["b"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("Cycle")));
  });

  it("rejects empty steps", () => {
    const def: WorkflowDef = { name: "test", steps: [] };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("at least one step")));
  });
});

describe("validateStepOutput", () => {
  it("passes with all required fields", () => {
    const step = { id: "s1", description: "test", required_output: ["a", "b"] };
    const result = validateStepOutput(step, { a: 1, b: "hello" });
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it("fails with missing field", () => {
    const step = { id: "s1", description: "test", required_output: ["a", "b"] };
    const result = validateStepOutput(step, { a: 1 });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("'b'")));
  });

  it("applies min_length rule", () => {
    const step = {
      id: "s1",
      description: "test",
      required_output: ["items"],
      validation: [{ field: "items", op: "min_length" as const, value: 2 }],
    };
    const result = validateStepOutput(step, { items: ["one"] });
    assert.ok(!result.valid);
  });

  it("applies min/max rules", () => {
    const step = {
      id: "s1",
      description: "test",
      required_output: ["score"],
      validation: [
        { field: "score", op: "min" as const, value: 1 },
        { field: "score", op: "max" as const, value: 10 },
      ],
    };
    assert.ok(validateStepOutput(step, { score: 5 }).valid);
    assert.ok(!validateStepOutput(step, { score: 0 }).valid);
    assert.ok(!validateStepOutput(step, { score: 11 }).valid);
  });

  it("applies type rule", () => {
    const step = {
      id: "s1",
      description: "test",
      required_output: ["data"],
      validation: [{ field: "data", op: "type" as const, value: "array" }],
    };
    assert.ok(validateStepOutput(step, { data: [1, 2] }).valid);
    assert.ok(!validateStepOutput(step, { data: "string" }).valid);
  });
});

describe("pickTips", () => {
  it("returns empty for no tips", () => {
    assert.deepEqual(pickTips(undefined, 2), []);
    assert.deepEqual(pickTips([], 2), []);
  });

  it("returns at most count tips", () => {
    const tips = ["a", "b", "c", "d"];
    const result = pickTips(tips, 2);
    assert.equal(result.length, 2);
    for (const t of result) assert.ok(tips.includes(t));
  });

  it("returns all tips if count exceeds pool size", () => {
    const tips = ["a"];
    const result = pickTips(tips, 5);
    assert.equal(result.length, 1);
  });
});

describe("generateId", () => {
  it("returns MMDD-HHmmss format", () => {
    const id = generateId();
    assert.match(id, /^\d{4}-\d{6}$/);
  });
});

describe("E2E workflow flow", () => {
  const testDir = path.resolve("test-e2e-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    // Copy workflow fixture
    fs.mkdirSync("workflows", { recursive: true });
    fs.copyFileSync(
      path.resolve(origCwd, "test/fixtures/code-review.yml"),
      path.resolve(testDir, "workflows/code-review.yml"),
    );
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("runs full create → start → next → complete cycle", async () => {
    // Dynamic imports to run in test dir context
    const { createInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const { loadInstance, saveInstance } = await import("../src/engine/state.js");
    const { validateStepOutput } = await import("../src/engine/validator.js");
    const { appendLog } = await import("../src/audit/logger.js");

    // Create
    const def = loadWorkflow("code-review");
    assert.equal(def.name, "code-review");
    assert.equal(def.steps.length, 3);

    const state = createInstance(def);
    assert.ok(state.id);
    assert.equal(state.status, "created");
    assert.equal(Object.keys(state.steps).length, 3);

    // Start step 1
    state.steps["analyze"].status = "in_progress";
    state.status = "in_progress";
    state.current_step = 0;
    saveInstance(state);

    // Submit step 1
    const output1 = { file_list: ["a.ts", "b.ts"], complexity_score: 5 };
    const v1 = validateStepOutput(def.steps[0], output1);
    assert.ok(v1.valid);

    state.steps["analyze"].status = "completed";
    state.steps["analyze"].output = output1;
    Object.assign(state.context, output1);

    // Start step 2
    state.steps["review"].status = "in_progress";
    state.current_step = 1;
    saveInstance(state);

    // Submit step 2
    const output2 = {
      comments: [{ file: "a.ts", line: 10, text: "Fix this" }],
      severity_counts: { critical: 0, warning: 1 },
    };
    const v2 = validateStepOutput(def.steps[1], output2);
    assert.ok(v2.valid);

    state.steps["review"].status = "completed";
    state.steps["review"].output = output2;
    Object.assign(state.context, output2);

    // Start step 3
    state.steps["summary"].status = "in_progress";
    state.current_step = 2;
    saveInstance(state);

    // Submit step 3
    const output3 = { verdict: "approve", summary_text: "All looks good, minor warning only." };
    const v3 = validateStepOutput(def.steps[2], output3);
    assert.ok(v3.valid);

    state.steps["summary"].status = "completed";
    state.steps["summary"].output = output3;
    state.status = "completed";
    saveInstance(state);

    // Verify final state
    const finalState = loadInstance(state.id);
    assert.equal(finalState.status, "completed");
    for (const stepId of ["analyze", "review", "summary"]) {
      assert.equal(finalState.steps[stepId].status, "completed");
    }

    // Verify rejection
    const badResult = validateStepOutput(def.steps[0], {});
    assert.ok(!badResult.valid);
    assert.equal(badResult.errors.length, 2); // missing file_list, complexity_score

    // Verify audit log
    appendLog(state.id, "test_event", "analyze", { test: true });
    const logPath = path.resolve(".llm-rail", "logs", `${state.id}.jsonl`);
    assert.ok(fs.existsSync(logPath));
    const logLines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
    assert.ok(logLines.length >= 1);
    const entry = JSON.parse(logLines[0]);
    assert.equal(entry.instance_id, state.id);
  });
});
