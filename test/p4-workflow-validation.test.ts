import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateWorkflowV1Def } from "../src/engine/workflow-v1.js";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";

function mk(overrides: Partial<WorkflowV1Def> & { steps: V1StepDef[] }): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name: "v",
    schemas: { Input: { type: "object" }, Output: { type: "object" } },
    input: "Input",
    output: "Output",
    ...overrides,
  };
}

const okStep: V1StepDef = {
  id: "s1",
  type: "programmatic",
  required_output: "Output",
  actions: [{ name: "x", description: "x", js: "return {};" }],
};

// ── Name edge cases ──

describe("validate — name edge cases beyond baseline", () => {
  it("rejects an instance-id-shaped name (e.g. 2026-040405-...)", () => {
    const errs = validateWorkflowV1Def(mk({ name: "2026-040405", steps: [okStep] }));
    assert.ok(errs.some((e) => /looks like an instance id/i.test(e)), errs.join("|"));
  });

  it("accepts ordinary kebab/snake names", () => {
    for (const name of ["my-wf", "wf_one", "wf123", "x"]) {
      const errs = validateWorkflowV1Def(mk({ name, steps: [okStep] }));
      assert.ok(!errs.some((e) => /name/.test(e)), `unexpected name error for '${name}': ${errs.join("|")}`);
    }
  });
});

// ── phase ──

describe("validate — phase", () => {
  it("rejects unknown phase value", () => {
    const errs = validateWorkflowV1Def(
      mk({ steps: [okStep], phase: "production" as never }),
    );
    assert.ok(errs.some((e) => /Invalid phase/.test(e)), errs.join("|"));
  });
  for (const phase of ["draft", "dev", "stable"] as const) {
    it(`accepts phase=${phase}`, () => {
      const errs = validateWorkflowV1Def(mk({ steps: [okStep], phase }));
      assert.ok(!errs.some((e) => /phase/i.test(e)), errs.join("|"));
    });
  }
});

// ── max_depth ──

describe("validate — max_depth boundary", () => {
  it("rejects 0", () => {
    const errs = validateWorkflowV1Def(mk({ steps: [okStep], max_depth: 0 }));
    assert.ok(errs.some((e) => /max_depth must be a positive integer/.test(e)));
  });
  it("rejects negative", () => {
    const errs = validateWorkflowV1Def(mk({ steps: [okStep], max_depth: -1 }));
    assert.ok(errs.some((e) => /max_depth/.test(e)));
  });
  it("rejects non-integer", () => {
    const errs = validateWorkflowV1Def(mk({ steps: [okStep], max_depth: 1.5 }));
    assert.ok(errs.some((e) => /max_depth/.test(e)));
  });
  it("accepts 1", () => {
    const errs = validateWorkflowV1Def(mk({ steps: [okStep], max_depth: 1 }));
    assert.ok(!errs.some((e) => /max_depth/.test(e)));
  });
});

// ── steps structural ──

describe("validate — steps structural", () => {
  it("rejects step with no id", () => {
    const errs = validateWorkflowV1Def(mk({ steps: [{ ...okStep, id: "" } as V1StepDef] }));
    assert.ok(errs.some((e) => /must have an id/.test(e)));
  });
  it("rejects step with unknown type", () => {
    const errs = validateWorkflowV1Def(
      mk({ steps: [{ id: "x", type: "magic" as never } as V1StepDef] }),
    );
    assert.ok(errs.some((e) => /unknown type 'magic'/.test(e)), errs.join("|"));
  });
});

// ── programmatic action shape ──

describe("validate — programmatic actions", () => {
  it("rejects empty actions array", () => {
    const errs = validateWorkflowV1Def(
      mk({ steps: [{ id: "p", type: "programmatic", required_output: "Output", actions: [] }] }),
    );
    assert.ok(errs.some((e) => /at least one action/.test(e)));
  });
  it("rejects action with neither js nor shell", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [{
          id: "p", type: "programmatic", required_output: "Output",
          actions: [{ name: "x", description: "x" } as never],
        }],
      }),
    );
    assert.ok(errs.some((e) => /exactly one of 'js' or 'shell'/.test(e)));
  });
  it("rejects action with both js and shell", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [{
          id: "p", type: "programmatic", required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return {};", shell: "echo ok" }],
        }],
      }),
    );
    assert.ok(errs.some((e) => /got both/.test(e)));
  });
  it("rejects js + extract combination", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [{
          id: "p", type: "programmatic", required_output: "Output",
          actions: [{ name: "x", description: "x", js: "return {};", extract: { y: "y" } }],
        }],
      }),
    );
    assert.ok(errs.some((e) => /'js' action cannot use 'extract'/.test(e)));
  });
  it("rejects empty action.name", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [{
          id: "p", type: "programmatic", required_output: "Output",
          actions: [{ name: "", description: "x", js: "return {};" }],
        }],
      }),
    );
    assert.ok(errs.some((e) => /non-empty 'name'/.test(e)));
  });
  it("rejects whitespace-only action.description", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [{
          id: "p", type: "programmatic", required_output: "Output",
          actions: [{ name: "x", description: "   ", js: "return {};" }],
        }],
      }),
    );
    assert.ok(errs.some((e) => /non-empty 'description'/.test(e)));
  });
  it("rejects programmatic required_output referencing unknown schema", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [{
          id: "p", type: "programmatic", required_output: "Ghost",
          actions: [{ name: "x", description: "x", js: "return {};" }],
        }],
      }),
    );
    assert.ok(errs.some((e) => /required_output references unknown schema 'Ghost'/.test(e)));
  });
});

// ── router shape ──

describe("validate — router shape edges", () => {
  it("rejects cases that is not an array", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [
          { id: "r", type: "router", cases: "oops" as never, default: "end" } as V1StepDef,
          okStep,
        ],
      }),
    );
    assert.ok(errs.some((e) => /'cases' array/.test(e)));
  });
  it("rejects case missing 'when'", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [
          { id: "r", type: "router", cases: [{ goto: "s1" } as never], default: "s1" } as V1StepDef,
          okStep,
        ],
      }),
    );
    assert.ok(errs.some((e) => /must have 'when'/.test(e)));
  });
  it("rejects case missing 'goto'", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [
          { id: "r", type: "router", cases: [{ when: { field: "x", op: "exists" } } as never], default: "s1" } as V1StepDef,
          okStep,
        ],
      }),
    );
    assert.ok(errs.some((e) => /must have 'goto'/.test(e)));
  });
  it("rejects default referencing unknown step", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [
          { id: "r", type: "router", cases: [], default: "ghost" },
          okStep,
        ],
      }),
    );
    assert.ok(errs.some((e) => /default references unknown step 'ghost'/.test(e)));
  });
  it("rejects max_iterations = 0", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [
          { id: "r", type: "router", cases: [], default: "s1", max_iterations: 0 },
          okStep,
        ],
      }),
    );
    assert.ok(errs.some((e) => /max_iterations must be a positive integer/.test(e)));
  });
  it("rejects negative max_iterations", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [
          { id: "r", type: "router", cases: [], default: "s1", max_iterations: -3 },
          okStep,
        ],
      }),
    );
    assert.ok(errs.some((e) => /max_iterations/.test(e)));
  });
  it("rejects non-integer max_iterations", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [
          { id: "r", type: "router", cases: [], default: "s1", max_iterations: 1.5 },
          okStep,
        ],
      }),
    );
    assert.ok(errs.some((e) => /max_iterations/.test(e)));
  });
});

// ── context_in object form ──

describe("validate — context_in object form", () => {
  it("flags object form whose type references unknown schema", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [
          {
            ...okStep,
            id: "src",
            type: "programmatic",
            required_output: "Output",
            actions: [{ name: "x", description: "x", js: "return {};" }],
          },
          {
            id: "use",
            type: "programmatic",
            required_output: "Output",
            context_in: { v: { from: "{src.x}", type: "Ghost" } },
            actions: [{ name: "x", description: "x", js: "return {};" }],
          },
        ],
      }),
    );
    assert.ok(errs.some((e) => /context_in 'v' references unknown schema 'Ghost'/.test(e)));
  });

  it("accepts the _tools sentinel as a context_in source", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [{
          id: "use",
          type: "agentic",
          instruction: "use tool result",
          required_output: "Output",
          context_in: { val: "{_tools.search.result}" },
        }],
      }),
    );
    // Must not complain about unknown step '_tools'
    assert.ok(!errs.some((e) => /_tools/.test(e)), errs.join("|"));
  });
});

// ── Policy on workflow ──

describe("validate — workflow policy", () => {
  it("rejects unknown policy mode", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [okStep],
        policy: { mode: "casual" as never },
      }),
    );
    assert.ok(errs.some((e) => /Policy mode must be 'trail' or 'enforce'/.test(e)));
  });
  it("rejects enforce policy with empty rules", () => {
    const errs = validateWorkflowV1Def(
      mk({
        steps: [okStep],
        policy: { mode: "enforce", rules: [] },
      }),
    );
    assert.ok(errs.some((e) => /enforce mode must have at least one rule/.test(e)));
  });
  it("accepts trail policy without rules", () => {
    const errs = validateWorkflowV1Def(
      mk({ steps: [okStep], policy: { mode: "trail" } }),
    );
    assert.ok(!errs.some((e) => /Policy/i.test(e)), errs.join("|"));
  });
});
