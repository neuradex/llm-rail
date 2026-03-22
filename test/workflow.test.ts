import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { WorkflowDef, InstanceState, StepDef } from "../src/types.js";
import { validateWorkflowDef } from "../src/engine/workflow.js";
import { validateStepOutput, runAssertions } from "../src/engine/validator.js";
import { pickTips } from "../src/engine/tip-pool.js";
import { generateId } from "../src/util.js";
import { resolveTemplate, buildStepContext, collectStepOutputs } from "../src/engine/context.js";
import { collectDownstream, isReady } from "../src/engine/dependency.js";

// ── validateWorkflowDef ──

describe("validateWorkflowDef", () => {
  it("accepts a valid workflow", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "Step 1", required_output: ["a"] },
        { id: "s2", instruction: "Step 2", depends_on: "s1", required_output: ["b"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("accepts multiple depends_on", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "Step 1", required_output: ["a"] },
        { id: "s2", instruction: "Step 2", required_output: ["b"] },
        { id: "s3", instruction: "Step 3", depends_on: ["s1", "s2"], required_output: ["c"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("rejects duplicate step IDs", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "Step 1", required_output: ["a"] },
        { id: "s1", instruction: "Step 1 dup", required_output: ["b"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("Duplicate")));
  });

  it("rejects invalid depends_on reference", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "Step 1", depends_on: "nonexistent", required_output: ["a"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("unknown step")));
  });

  it("rejects invalid depends_on in array form", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "Step 1", required_output: ["a"] },
        { id: "s2", instruction: "Step 2", depends_on: ["s1", "bad"], required_output: ["b"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("unknown step 'bad'")));
  });

  it("detects cycles", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "Step 1", depends_on: "s2", required_output: ["a"] },
        { id: "s2", instruction: "Step 2", depends_on: "s1", required_output: ["b"] },
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

  it("validates context_in references", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "Step 1", required_output: ["a"] },
        {
          id: "s2",
          instruction: "Step 2",
          depends_on: "s1",
          required_output: ["b"],
          context_in: { data: "{unknown.field}" },
        },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("unknown step 'unknown'")));
  });

  it("accepts explicit agentic type with instruction and required_output", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", type: "agentic", instruction: "Step 1", required_output: ["a"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("accepts programmatic type with actions", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", type: "programmatic", actions: [{ shell: "echo hello" }] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("rejects programmatic type without actions", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", type: "programmatic" } as any,
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("must have at least one action")));
  });

  it("rejects action with empty run", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", type: "programmatic", actions: [{ shell: "" }] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("non-empty")));
  });

  it("validates policy mode", () => {
    const def: WorkflowDef = {
      name: "test",
      policy: { mode: "invalid" as any },
      steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("trail") && e.includes("enforce")));
  });

  it("requires rules for enforce mode", () => {
    const def: WorkflowDef = {
      name: "test",
      policy: { mode: "enforce" },
      steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("enforce") && e.includes("rule")));
  });

  it("accepts trail mode without rules", () => {
    const def: WorkflowDef = {
      name: "test",
      policy: { mode: "trail" },
      steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("validates param definitions", () => {
    const def: WorkflowDef = {
      name: "test",
      params: { x: { type: "invalid" as any } },
      steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("invalid type")));
  });

  it("accepts valid phase values", () => {
    for (const phase of ["draft", "dev"] as const) {
      const def: WorkflowDef = {
        name: "test",
        phase,
        steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
      };
      const errors = validateWorkflowDef(def);
      assert.equal(errors.length, 0, `phase '${phase}' should be valid`);
    }
  });

  it("rejects invalid phase", () => {
    const def: WorkflowDef = {
      name: "test",
      phase: "beta" as any,
      steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("Invalid phase")));
  });

  it("stable phase requires enforce policy", () => {
    const def: WorkflowDef = {
      name: "test",
      phase: "stable",
      steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("enforce")));
  });

  it("stable phase allows agentic steps with enforce policy", () => {
    const def: WorkflowDef = {
      name: "test",
      phase: "stable",
      policy: { mode: "enforce", rules: [{ effect: "allow", commands: ["echo *"] }] },
      steps: [
        { id: "s1", instruction: "Agentic step", required_output: ["a"] },
        { id: "s2", type: "programmatic", actions: [{ shell: "echo hello" }] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("rejects reserved workflow names", () => {
    const def: WorkflowDef = {
      name: "list",
      steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("reserved")));
  });

  it("rejects instance-ID-like workflow names", () => {
    const def: WorkflowDef = {
      name: "0321-164541",
      steps: [{ id: "s1", instruction: "Step 1", required_output: ["a"] }],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("instance ID")));
  });

  it("rejects agentic step without instruction", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", description: "Step 1", required_output: ["a"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("must have an instruction")));
  });

  it("accepts agentic step with instruction but no description", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "Do the thing", required_output: ["a"] },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });
});

// ── validateStepOutput ──

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

// ── New assertion ops ──

describe("assertion ops", () => {
  it("eq / neq", () => {
    const rules = [{ field: "status", op: "eq" as const, value: "ok" }];
    assert.ok(runAssertions(rules, { status: "ok" }).valid);
    assert.ok(!runAssertions(rules, { status: "fail" }).valid);

    const neqRules = [{ field: "x", op: "neq" as const, value: 0 }];
    assert.ok(runAssertions(neqRules, { x: 1 }).valid);
    assert.ok(!runAssertions(neqRules, { x: 0 }).valid);
  });

  it("between", () => {
    const rules = [{ field: "score", op: "between" as const, value: [1, 10] }];
    assert.ok(runAssertions(rules, { score: 5 }).valid);
    assert.ok(!runAssertions(rules, { score: 0 }).valid);
    assert.ok(!runAssertions(rules, { score: 11 }).valid);
  });

  it("contains / not_contains", () => {
    const rules = [{ field: "text", op: "contains" as const, value: "hello" }];
    assert.ok(runAssertions(rules, { text: "say hello world" }).valid);
    assert.ok(!runAssertions(rules, { text: "goodbye" }).valid);

    const ncRules = [{ field: "text", op: "not_contains" as const, value: "secret" }];
    assert.ok(runAssertions(ncRules, { text: "hello" }).valid);
    assert.ok(!runAssertions(ncRules, { text: "top secret" }).valid);
  });

  it("matches (regex)", () => {
    const rules = [{ field: "email", op: "matches" as const, value: "^\\S+@\\S+$" }];
    assert.ok(runAssertions(rules, { email: "a@b.com" }).valid);
    assert.ok(!runAssertions(rules, { email: "not email" }).valid);
  });

  it("one_of", () => {
    const rules = [{ field: "v", op: "one_of" as const, value: ["a", "b", "c"] }];
    assert.ok(runAssertions(rules, { v: "b" }).valid);
    assert.ok(!runAssertions(rules, { v: "d" }).valid);
  });

  it("each_has", () => {
    const rules = [{ field: "items", op: "each_has" as const, value: "id" }];
    assert.ok(runAssertions(rules, { items: [{ id: 1 }, { id: 2 }] }).valid);
    assert.ok(!runAssertions(rules, { items: [{ id: 1 }, { name: "x" }] }).valid);
  });

  it("not_empty", () => {
    const rules = [{ field: "x", op: "not_empty" as const }];
    assert.ok(runAssertions(rules, { x: "hello" }).valid);
    assert.ok(!runAssertions(rules, { x: "" }).valid);
    assert.ok(!runAssertions(rules, { x: [] }).valid);
  });

  it("gt / gte / lt / lte", () => {
    assert.ok(runAssertions([{ field: "n", op: "gt" as const, value: 5 }], { n: 6 }).valid);
    assert.ok(!runAssertions([{ field: "n", op: "gt" as const, value: 5 }], { n: 5 }).valid);
    assert.ok(runAssertions([{ field: "n", op: "gte" as const, value: 5 }], { n: 5 }).valid);
    assert.ok(runAssertions([{ field: "n", op: "lt" as const, value: 5 }], { n: 4 }).valid);
    assert.ok(!runAssertions([{ field: "n", op: "lt" as const, value: 5 }], { n: 5 }).valid);
    assert.ok(runAssertions([{ field: "n", op: "lte" as const, value: 5 }], { n: 5 }).valid);
  });

  it("max_length / length", () => {
    assert.ok(
      runAssertions([{ field: "s", op: "max_length" as const, value: 5 }], { s: "abc" }).valid,
    );
    assert.ok(
      !runAssertions([{ field: "s", op: "max_length" as const, value: 2 }], { s: "abc" }).valid,
    );
    assert.ok(
      runAssertions([{ field: "s", op: "length" as const, value: 3 }], { s: "abc" }).valid,
    );
    assert.ok(
      !runAssertions([{ field: "s", op: "length" as const, value: 2 }], { s: "abc" }).valid,
    );
  });

  it("custom message", () => {
    const rules = [
      { field: "x", op: "eq" as const, value: 0, message: "x must be zero" },
    ];
    const result = runAssertions(rules, { x: 1 });
    assert.ok(!result.valid);
    assert.ok(result.errors[0].includes("x must be zero"));
  });

  it("verify_source — rejects missing url field", () => {
    const rules = [
      {
        field: "items",
        op: "verify_source" as const,
        value: { url_field: "source_url", field_snippets: { per: "per_snippet" } },
      },
    ];
    const r1 = runAssertions(rules, {
      items: [{ ticker: "X", per: 10, per_snippet: "PE 10" }],
    });
    assert.ok(!r1.valid);
    assert.ok(r1.errors[0].includes("source_url"));
  });

  it("verify_source — rejects missing snippet field", () => {
    const rules = [
      {
        field: "items",
        op: "verify_source" as const,
        value: { url_field: "source_url", field_snippets: { per: "per_snippet" } },
      },
    ];
    const result = runAssertions(rules, {
      items: [{ ticker: "X", per: 10, source_url: "https://example.com" }],
    });
    assert.ok(!result.valid);
    assert.ok(result.errors[0].includes("per_snippet"));
  });

  it("verify_source — rejects when snippet not found at URL", () => {
    const rules = [
      {
        field: "items",
        op: "verify_source" as const,
        value: { url_field: "source_url", field_snippets: { per: "per_snippet" } },
      },
    ];
    const result = runAssertions(rules, {
      items: [
        {
          ticker: "X",
          per: 10,
          source_url: "https://example.com",
          per_snippet: "PE Ratio 10 — this-text-does-not-exist-xyz123",
        },
      ],
    });
    assert.ok(!result.valid);
    assert.ok(result.errors[0].includes("not found"));
  });

  it("verify_source — rejects when snippet lacks data value", () => {
    const rules = [
      {
        field: "items",
        op: "verify_source" as const,
        value: { url_field: "source_url", field_snippets: { per: "per_snippet", roe: "roe_snippet" } },
      },
    ];
    const result = runAssertions(rules, {
      items: [
        {
          ticker: "X",
          per: 17.33,
          roe: 14.48,
          source_url: "https://example.com",
          per_snippet: "Sony",
          roe_snippet: "ROE is 14.48%",
        },
      ],
    });
    assert.ok(!result.valid);
    assert.ok(result.errors[0].includes("per_snippet does not contain per=17.33"));
  });

  it("verify_source — skips null data values", () => {
    const rules = [
      {
        field: "items",
        op: "verify_source" as const,
        value: { url_field: "source_url", field_snippets: { per: "per_snippet", roe: "roe_snippet" } },
      },
    ];
    // per is null → skips per check, roe_snippet contains roe value but won't be on example.com
    const result = runAssertions(rules, {
      items: [
        {
          ticker: "X",
          per: null,
          roe: 14.48,
          source_url: "https://example.com",
          per_snippet: "N/A",
          roe_snippet: "ROE is 14.48%",
        },
      ],
    });
    assert.ok(!result.valid);
    // Error should be about URL fetch, not about snippet value check
    assert.ok(!result.errors[0].includes("does not contain"));
  });

  it("verify_source — accepts per-field snippets at URL", () => {
    const rules = [
      {
        field: "items",
        op: "verify_source" as const,
        value: { url_field: "source_url", field_snippets: { per: "per_snippet" } },
      },
    ];
    const result = runAssertions(rules, {
      items: [
        {
          ticker: "X",
          per: null,
          source_url: "https://example.com",
          per_snippet: "whatever",
        },
      ],
    });
    // per is null → skips, no snippets to verify → passes
    assert.ok(result.valid);
  });
});

// ── Script assertions ──

describe("script assertions", () => {
  it("passes when script exits 0", () => {
    const rules = [{ field: "score", op: "script" as const, value: "exit 0" }];
    assert.ok(runAssertions(rules, { score: 42 }).valid);
  });

  it("fails when script exits non-zero", () => {
    const rules = [{ field: "score", op: "script" as const, value: "echo 'too low' >&2; exit 1" }];
    const result = runAssertions(rules, { score: 42 });
    assert.ok(!result.valid);
    assert.ok(result.errors[0].includes("too low"));
  });

  it("receives FIELD_VALUE env var", () => {
    const rules = [
      { field: "count", op: "script" as const, value: "test $(echo $FIELD_VALUE) -gt 5" },
    ];
    assert.ok(runAssertions(rules, { count: 10 }).valid);
    assert.ok(!runAssertions(rules, { count: 3 }).valid);
  });

  it("returns script_logs in ValidationResult", () => {
    const rules = [{ field: "x", op: "script" as const, value: "echo hello" }];
    const result = runAssertions(rules, { x: 1 });
    assert.ok(result.valid);
    assert.ok(result.script_logs);
    assert.equal(result.script_logs!.length, 1);
    assert.equal(result.script_logs![0].field, "x");
    assert.equal(result.script_logs![0].exit_code, 0);
    assert.equal(result.script_logs![0].stdout, "hello");
  });

  it("returns script_logs on failure with stderr", () => {
    const rules = [{ field: "x", op: "script" as const, value: "echo debug; echo 'bad' >&2; exit 1" }];
    const result = runAssertions(rules, { x: 1 });
    assert.ok(!result.valid);
    assert.ok(result.script_logs);
    assert.equal(result.script_logs![0].exit_code, 1);
    assert.equal(result.script_logs![0].stdout, "debug");
    assert.equal(result.script_logs![0].stderr, "bad");
  });

  it("receives CONTEXT env var with full data", () => {
    const rules = [
      {
        field: "ratio",
        op: "script" as const,
        value: "echo $CONTEXT | python3 -c \"import sys,json; d=json.load(sys.stdin); sys.exit(0 if d['ratio']>d['baseline_ratio'] else 1)\"",
      },
    ];
    assert.ok(runAssertions(rules, { ratio: 0.8, baseline_ratio: 0.5 }).valid);
    assert.ok(!runAssertions(rules, { ratio: 0.3, baseline_ratio: 0.5 }).valid);
  });
});

// ── Context resolution ──

describe("context resolution", () => {
  it("resolves {{param}} templates", () => {
    const result = resolveTemplate("Review {{repo}} on {{branch}}", { repo: "src/", branch: "main" }, {});
    assert.equal(result, "Review src/ on main");
  });

  it("resolves {stepId.field} templates", () => {
    const outputs = { analyze: { file_list: ["a.ts"], score: 7 } };
    const result = resolveTemplate("Score is {analyze.score}", {}, outputs);
    assert.equal(result, "Score is 7");
  });

  it("resolves mixed templates", () => {
    const result = resolveTemplate(
      "{{repo}}: {analyze.score} files",
      { repo: "myapp" },
      { analyze: { score: 5 } },
    );
    assert.equal(result, "myapp: 5 files");
  });

  it("preserves unresolved templates", () => {
    const result = resolveTemplate("{{unknown}} and {missing.field}", {}, {});
    assert.equal(result, "{{unknown}} and {missing.field}");
  });

  it("buildStepContext resolves context_in", () => {
    const stepDef = {
      id: "s2",
      instruction: "test",
      required_output: ["x"],
      context_in: {
        files: "{s1.file_list}",
        name: "{{repo}}",
      },
    };
    const ctx = buildStepContext(stepDef, { repo: "myrepo" }, { s1: { file_list: ["a.ts", "b.ts"] } });
    assert.deepEqual(ctx.files, ["a.ts", "b.ts"]);
    assert.equal(ctx.name, "myrepo");
  });

  it("collectStepOutputs gathers outputs", () => {
    const steps = {
      s1: { status: "completed" as const, output: { a: 1 } },
      s2: { status: "pending" as const },
    };
    const outputs = collectStepOutputs(steps);
    assert.deepEqual(outputs, { s1: { a: 1 } });
  });
});

// ── Dependency ──

describe("dependency", () => {
  it("collectDownstream finds cascade targets", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "1", required_output: ["a"] },
        { id: "s2", instruction: "2", depends_on: "s1", required_output: ["b"] },
        { id: "s3", instruction: "3", depends_on: "s2", required_output: ["c"] },
        { id: "s4", instruction: "4", required_output: ["d"] },
      ],
    };
    const downstream = collectDownstream(def, "s1");
    assert.deepEqual(downstream.sort(), ["s2", "s3"]);
  });

  it("isReady checks all dependencies", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        { id: "s1", instruction: "1", required_output: ["a"] },
        { id: "s2", instruction: "2", required_output: ["b"] },
        { id: "s3", instruction: "3", depends_on: ["s1", "s2"], required_output: ["c"] },
      ],
    };
    const steps: InstanceState["steps"] = {
      s1: { status: "completed" },
      s2: { status: "pending" },
      s3: { status: "pending" },
    };
    assert.equal(isReady(def, "s3", steps), false);

    steps.s2.status = "completed";
    assert.equal(isReady(def, "s3", steps), true);
  });

  it("isReady returns true for steps with no dependencies", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [{ id: "s1", instruction: "1", required_output: ["a"] }],
    };
    assert.equal(isReady(def, "s1", { s1: { status: "pending" } }), true);
  });
});

// ── pickTips ──

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

// ── generateId ──

describe("generateId", () => {
  it("returns MMDD-HHmmss format", () => {
    const id = generateId();
    assert.match(id, /^\d{4}-\d{6}$/);
  });
});

// ── E2E workflow flow ──

describe("E2E workflow flow", () => {
  const testDir = path.resolve("test-e2e-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
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
    assert.equal(badResult.errors.length, 2);

    // Verify audit log
    appendLog(def.name, state.id, "test_event", "analyze", { test: true });
    const logPath = path.resolve(".llm-rail", def.name, state.id, "audit.jsonl");
    assert.ok(fs.existsSync(logPath));
    const logLines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
    assert.ok(logLines.length >= 1);
    const entry = JSON.parse(logLines[0]);
    assert.equal(entry.instance_id, state.id);
  });
});

// ── E2E with params and context ──

describe("E2E with params and context_in", () => {
  const testDir = path.resolve("test-e2e-params-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    fs.mkdirSync("workflows", { recursive: true });

    const workflow = {
      name: "param-test",
      params: {
        target: { type: "string", required: true },
      },
      steps: [
        {
          id: "step1",
          description: "Analyze target",
          instruction: "Analyze {{target}}",
          required_output: ["result"],
          validation: [{ field: "result", op: "not_empty" }],
        },
        {
          id: "step2",
          description: "Process result",
          instruction: "Process result",
          depends_on: "step1",
          context_in: { data: "{step1.result}" },
          required_output: ["summary"],
          assertions: [{ field: "summary", op: "min_length", value: 5 }],
        },
      ],
    };

    fs.writeFileSync(
      path.resolve(testDir, "workflows/param-test.yml"),
      yaml.dump(workflow),
    );
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("creates instance with params and resolves context", async () => {
    const { createInstance, loadInstance, saveInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const { validateStepOutput, runAssertions } = await import("../src/engine/validator.js");
    const { resolveInstruction, buildStepContext, collectStepOutputs } = await import("../src/engine/context.js");

    const def = loadWorkflow("param-test");
    const state = createInstance(def, { target: "myrepo" });
    assert.deepEqual(state.params, { target: "myrepo" });

    // Resolve instruction
    const instr = resolveInstruction(def.steps[0].instruction!, state.params!, {});
    assert.equal(instr, "Analyze myrepo");

    // Step 1 complete
    state.steps["step1"].status = "completed";
    state.steps["step1"].output = { result: "found issues" };
    Object.assign(state.context, state.steps["step1"].output);
    saveInstance(state);

    // Build context for step 2
    const outputs = collectStepOutputs(state.steps);
    const ctx = buildStepContext(def.steps[1], state.params!, outputs);
    assert.equal(ctx.data, "found issues");

    // Assertions pass
    const aResult = runAssertions(def.steps[1].assertions!, { summary: "All clear no issues" });
    assert.ok(aResult.valid);

    // Assertions fail
    const aFail = runAssertions(def.steps[1].assertions!, { summary: "ok" });
    assert.ok(!aFail.valid);
  });
});

// ── Reset cascade ──

describe("reset cascade", () => {
  const testDir = path.resolve("test-reset-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    fs.mkdirSync("workflows", { recursive: true });

    const workflow = {
      name: "reset-test",
      steps: [
        { id: "s1", instruction: "Step 1", required_output: ["a"] },
        { id: "s2", instruction: "Step 2", depends_on: "s1", required_output: ["b"] },
        { id: "s3", instruction: "Step 3", depends_on: "s2", required_output: ["c"] },
      ],
    };
    fs.writeFileSync(
      path.resolve(testDir, "workflows/reset-test.yml"),
      yaml.dump(workflow),
    );
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("resets step and cascades downstream", async () => {
    const { createInstance, saveInstance, loadInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const { collectDownstream } = await import("../src/engine/dependency.js");

    const def = loadWorkflow("reset-test");
    const state = createInstance(def);

    // Complete all steps
    state.status = "completed";
    state.steps["s1"] = { status: "completed", output: { a: 1 } };
    state.steps["s2"] = { status: "completed", output: { b: 2 } };
    state.steps["s3"] = { status: "completed", output: { c: 3 } };
    Object.assign(state.context, { a: 1, b: 2, c: 3 });
    saveInstance(state);

    // Simulate reset of s1
    const downstream = collectDownstream(def, "s1");
    assert.deepEqual(downstream.sort(), ["s2", "s3"]);

    const allToReset = ["s1", ...downstream];
    for (const sid of allToReset) {
      const ss = state.steps[sid];
      if (ss.output) {
        for (const key of Object.keys(ss.output)) {
          delete state.context[key];
        }
      }
      ss.status = "pending";
      ss.output = undefined;
      ss.completed_at = undefined;
    }
    state.status = "in_progress";
    saveInstance(state);

    const reloaded = loadInstance(state.id);
    assert.equal(reloaded.steps["s1"].status, "pending");
    assert.equal(reloaded.steps["s2"].status, "pending");
    assert.equal(reloaded.steps["s3"].status, "pending");
    assert.equal(reloaded.status, "in_progress");
    assert.deepEqual(reloaded.context, {});
  });
});

// ── Mixed step types (programmatic + agentic) ──

describe("mixed step types", () => {
  const testDir = path.resolve("test-mixed-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    fs.mkdirSync("workflows", { recursive: true });

    const workflow = {
      name: "mixed-test",
      steps: [
        {
          id: "setup",
          type: "programmatic",
          actions: [
            { shell: `echo '{"version": "1.0", "ready": true}'`, extract: { version: "version", ready: "ready" } },
          ],
        },
        {
          id: "analyze",
          instruction: "Analyze the project",
          required_output: ["result"],
        },
        {
          id: "post-process",
          type: "programmatic",
          depends_on: "analyze",
          actions: [
            { shell: `echo '{"processed": true}'`, extract: { processed: "processed" } },
          ],
        },
        {
          id: "review",
          instruction: "Review results",
          depends_on: "post-process",
          required_output: ["verdict"],
        },
      ],
    };
    fs.writeFileSync(
      path.resolve(testDir, "workflows/mixed-test.yml"),
      yaml.dump(workflow),
    );
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("auto-executes programmatic steps and stops at agentic", async () => {
    const { createInstance, saveInstance, loadInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const { advanceThrough } = await import("../src/engine/runner.js");

    const def = loadWorkflow("mixed-test");
    const state = createInstance(def);
    state.status = "in_progress";

    // advanceThrough should auto-complete "setup" and stop at "analyze"
    const { reachedStep, autoCompleted } = advanceThrough(def, state);

    assert.deepEqual(autoCompleted, ["setup"]);
    assert.equal(reachedStep, 1); // index of "analyze"
    assert.equal(state.steps["setup"].status, "completed");
    assert.equal(state.steps["setup"].output?.version, "1.0");
    assert.equal(state.context.version, "1.0");
    assert.equal(state.context.ready, true);
  });

  it("auto-executes consecutive programmatic steps after agentic completion", async () => {
    const { createInstance, saveInstance, loadInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const { advanceThrough } = await import("../src/engine/runner.js");
    const { nowISO } = await import("../src/util.js");

    const def = loadWorkflow("mixed-test");
    const state = createInstance(def);
    state.status = "in_progress";

    // Manually complete setup and analyze
    state.steps["setup"] = { status: "completed", output: { version: "1.0", ready: true } };
    state.steps["analyze"] = { status: "completed", output: { result: "found bugs" }, completed_at: nowISO() };
    Object.assign(state.context, { version: "1.0", ready: true, result: "found bugs" });

    // advanceThrough should auto-complete "post-process" and stop at "review"
    const { reachedStep, autoCompleted } = advanceThrough(def, state);

    assert.deepEqual(autoCompleted, ["post-process"]);
    assert.equal(reachedStep, 3); // index of "review"
    assert.equal(state.steps["post-process"].status, "completed");
    assert.equal(state.context.processed, true);
  });

  it("returns -1 when all remaining steps are programmatic and complete", async () => {
    const { createInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const { advanceThrough } = await import("../src/engine/runner.js");
    const { nowISO } = await import("../src/util.js");

    // Create a workflow with only programmatic steps
    const allProgWorkflow = {
      name: "all-prog",
      steps: [
        { id: "s1", type: "programmatic", actions: [{ shell: `echo '{"a":1}'`, extract: { a: "a" } }] },
        { id: "s2", type: "programmatic", depends_on: "s1", actions: [{ shell: `echo '{"b":2}'`, extract: { b: "b" } }] },
      ],
    };
    fs.writeFileSync(
      path.resolve(testDir, "workflows/all-prog.yml"),
      yaml.dump(allProgWorkflow),
    );

    const def = loadWorkflow("all-prog");
    const state = createInstance(def);
    state.status = "in_progress";

    const { reachedStep, autoCompleted } = advanceThrough(def, state);

    assert.equal(reachedStep, -1);
    assert.deepEqual(autoCompleted, ["s1", "s2"]);
    assert.equal(state.context.a, 1);
    assert.equal(state.context.b, 2);
  });

  it("sets error state when programmatic action fails", async () => {
    const { createInstance, loadInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const { advanceThrough } = await import("../src/engine/runner.js");

    const failWorkflow = {
      name: "fail-prog",
      steps: [
        { id: "s1", type: "programmatic", actions: [{ shell: "exit 1" }] },
      ],
    };
    fs.writeFileSync(
      path.resolve(testDir, "workflows/fail-prog.yml"),
      yaml.dump(failWorkflow),
    );

    const def = loadWorkflow("fail-prog");
    const state = createInstance(def);
    state.status = "in_progress";

    assert.throws(() => {
      advanceThrough(def, state);
    }, /Action failed/);

    assert.equal(state.status, "error");
  });
});

// ── template resolution in validation values ──

describe("template resolution in validation values", () => {
  it("resolves {{param}} in validation value to number", () => {
    const template = "{{min_companies}}";
    const params = { min_companies: 50 };
    const resolved = resolveTemplate(template, params, {});
    assert.equal(resolved, "50");
    assert.equal(Number(resolved), 50);
    assert.ok(!isNaN(Number(resolved)), "resolved value must not be NaN");
  });

  it("NaN when template is NOT resolved (the bug)", () => {
    // This demonstrates the bug: unresolved template → NaN → validation always passes
    const unresolved = "{{min_companies}}";
    assert.ok(isNaN(Number(unresolved)), "unresolved template produces NaN");
  });

  it("min_length correctly rejects when template is resolved", () => {
    // After template resolution, min_length should work correctly
    const step: StepDef = {
      id: "test",
      instruction: "test",
      required_output: ["items"],
      validation: [{ field: "items", op: "min_length", value: 50 }],
    };
    const output = { items: Array.from({ length: 10 }, (_, i) => ({ id: i })) };
    const result = validateStepOutput(step, output);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("min_length 50")));
  });
});

// ── accumulate validation ──

describe("accumulate config validation", () => {
  it("accepts valid accumulate config", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        {
          id: "s1",
          instruction: "Collect items",
          required_output: ["items"],
          accumulate: { items: { key: "name" } },
        },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.equal(errors.length, 0);
  });

  it("rejects accumulate on programmatic step", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        {
          id: "s1",
          type: "programmatic",
          actions: [{ shell: "echo '{}'" }],
          accumulate: { items: { key: "name" } },
        },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("cannot use accumulate")));
  });

  it("rejects accumulate field without key", () => {
    const def: WorkflowDef = {
      name: "test",
      steps: [
        {
          id: "s1",
          instruction: "Collect",
          required_output: ["items"],
          accumulate: { items: { key: "" } },
        },
      ],
    };
    const errors = validateWorkflowDef(def);
    assert.ok(errors.some((e) => e.includes("must have a 'key'")));
  });
});
