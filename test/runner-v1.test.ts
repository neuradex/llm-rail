import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_FORMAT_MARKER,
  type WorkflowV1Def,
  type V1StepDef,
} from "../src/types-v1.js";
import { initialV1State } from "../src/engine/state-v1.js";
import {
  advance,
  submitAgenticResult,
  V1OutputValidationError,
  V1RunnerError,
} from "../src/engine/runner-v1.js";
import { nowISO } from "../src/util.js";

function mkDef(overrides: Partial<WorkflowV1Def> & { steps: V1StepDef[] }): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name: "runner-test",
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
    },
    input: "Input",
    output: "Output",
    ...overrides,
  };
}

function mkState(def: WorkflowV1Def, input: Record<string, unknown> = {}) {
  return initialV1State(def, "test-instance", undefined, input, nowISO());
}

describe("runner-v1 — programmatic chain", () => {
  it("auto-executes programmatic steps until workflow end", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        OneOut: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
        TwoOut: { type: "object", properties: { sum: { type: "integer" } }, required: ["sum"] },
      },
      steps: [
        {
          id: "one",
          type: "programmatic",
          required_output: "OneOut",
          actions: [
            { name: "seed", description: "produce 1", js: "return { n: 1 };" },
          ],
        },
        {
          id: "two",
          type: "programmatic",
          context_in: { n: "{one.n}" },
          required_output: "TwoOut",
          actions: [
            {
              name: "double",
              description: "n + n",
              js: "return { sum: context.n + context.n };",
            },
          ],
        },
      ],
    });
    const state = mkState(def);

    const result = advance(def, state);
    assert.equal(result.kind, "completed");
    assert.deepEqual(result.autoCompleted, ["one", "two"]);
    assert.equal(state.status, "completed");
    assert.deepEqual(state.steps.one.output, { n: 1 });
    assert.deepEqual(state.steps.two.output, { sum: 2 });
  });

  it("flows workflow input through context_in", () => {
    const def = mkDef({
      schemas: {
        Input: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        Output: { type: "object" },
        Greeting: {
          type: "object",
          properties: { greeting: { type: "string" } },
          required: ["greeting"],
        },
      },
      steps: [
        {
          id: "greet",
          type: "programmatic",
          context_in: { name: "{{name}}" },
          required_output: "Greeting",
          actions: [
            {
              name: "build",
              description: "format greeting",
              js: "return { greeting: `hi ${context.name}` };",
            },
          ],
        },
      ],
    });
    const state = mkState(def, { name: "world" });
    const result = advance(def, state);
    assert.equal(result.kind, "completed");
    assert.deepEqual(state.steps.greet.output, { greeting: "hi world" });
  });
});

describe("runner-v1 — agentic pause & resume", () => {
  const def: WorkflowV1Def = mkDef({
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
      ResearchResult: {
        type: "object",
        properties: {
          findings: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["findings"],
      },
      Summary: {
        type: "object",
        properties: { summary: { type: "string", minLength: 1 } },
        required: ["summary"],
      },
    },
    steps: [
      {
        id: "research",
        type: "agentic",
        instruction: "find things",
        required_output: "ResearchResult",
      },
      {
        id: "summarize",
        type: "programmatic",
        context_in: { findings: "{research.findings}" },
        required_output: "Summary",
        actions: [
          {
            name: "join",
            description: "concatenate",
            js: "return { summary: context.findings.join(', ') };",
          },
        ],
      },
    ],
  });

  it("pauses at agentic step", () => {
    const state = mkState(def);
    const result = advance(def, state);
    assert.equal(result.kind, "awaiting_agent");
    assert.equal(result.pendingStep?.id, "research");
    assert.equal(state.steps.research.status, "in_progress");
    assert.equal(state.status, "in_progress");
  });

  it("resumes through programmatic after valid agent submission", () => {
    const state = mkState(def);
    advance(def, state);
    const resumed = submitAgenticResult(def, state, {
      findings: ["a", "b", "c"],
    });
    assert.equal(resumed.kind, "completed");
    assert.deepEqual(state.steps.research.output, { findings: ["a", "b", "c"] });
    assert.deepEqual(state.steps.summarize.output, { summary: "a, b, c" });
  });

  it("rejects invalid agent output via schema", () => {
    const state = mkState(def);
    advance(def, state);
    assert.throws(
      () => submitAgenticResult(def, state, { findings: [] }),
      V1OutputValidationError,
    );
    // The step stays in_progress so the caller can retry
    assert.equal(state.steps.research.status, "in_progress");
  });
});

describe("runner-v1 — output schema violation on programmatic", () => {
  it("records error and halts when programmatic output fails validation", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        NeedsName: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      steps: [
        {
          id: "bad",
          type: "programmatic",
          required_output: "NeedsName",
          actions: [
            { name: "wrong", description: "missing name", js: "return { other: 1 };" },
          ],
        },
      ],
    });
    const state = mkState(def);
    const result = advance(def, state);
    assert.equal(result.kind, "error");
    assert.ok(result.error instanceof V1OutputValidationError);
    assert.equal(state.status, "error");
  });
});

describe("runner-v1 — v1 purity: no lrail injection", () => {
  it("throws ReferenceError when code tries to call lrail.set", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        R: { type: "object" },
      },
      steps: [
        {
          id: "s",
          type: "programmatic",
          required_output: "R",
          actions: [
            {
              name: "bad",
              description: "illegal lrail.set",
              js: "lrail.set({ x: 1 }); return {};",
            },
          ],
        },
      ],
    });
    const state = mkState(def);
    const result = advance(def, state);
    assert.equal(result.kind, "error");
    assert.ok(result.error?.message.includes("lrail"));
  });
});

describe("runner-v1 — call without registry", () => {
  it("errors when a call step is encountered but no registry is supplied", () => {
    const def = mkDef({
      steps: [
        { id: "c", type: "call", workflow: "other", inputs: {} },
      ],
    });
    const state = mkState(def);
    const result = advance(def, state); // no registry
    assert.equal(result.kind, "error");
    assert.ok(result.error instanceof V1RunnerError);
    assert.ok(result.error?.message.includes("registry"));
  });
});

describe("runner-v1 — context_in resolution errors", () => {
  it("errors if a prior step has not completed when referenced", () => {
    const def = mkDef({
      schemas: {
        Input: { type: "object" },
        Output: { type: "object" },
        FirstOut: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] },
        SecondOut: { type: "object" },
      },
      steps: [
        // agentic first (will pause), second tries to reference it — but
        // in this test we skip straight to trying to read a non-completed
        // ref by swapping order.
        {
          id: "second",
          type: "programmatic",
          context_in: { v: "{first.v}" },
          required_output: "SecondOut",
          actions: [
            { name: "noop", description: "ignored", js: "return {};" },
          ],
        },
        {
          id: "first",
          type: "agentic",
          instruction: "produce v",
          required_output: "FirstOut",
        },
      ],
    });
    const state = mkState(def);
    const result = advance(def, state);
    assert.equal(result.kind, "error");
    assert.ok(result.error?.message.includes("has not completed"));
  });
});
