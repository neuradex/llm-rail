/**
 * Script assertions can see the whole step output, and a rule's `env:` map resolves
 * `{step.field}` references against completed steps.
 *
 * Both existed as *intentions* in workflows before they existed in the engine. A rule
 * declared on one field would reach for its siblings through an env var nobody set, so
 * `JSON.parse(process.env.CONTEXT || "{}")` handed it `{}` and every check iterated
 * nothing — the assertion passed, said nothing, and logged nothing. Four assertions in
 * a downstream repo were dead that way for weeks. One of them was the only guard on
 * edge payloads; malformed edges reached the API, a foreign-key violation there
 * returned a 500, and the 500 killed whole workflow runs that then burned their full
 * retry budget.
 *
 * So these tests pin the two halves that make such a guard possible at all:
 * `STEP_OUTPUT` for sibling fields, and `env:` for facts from earlier steps.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_FORMAT_MARKER,
  type V1StepDef,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import { initialV1State } from "../src/engine/state-v1.js";
import { advance, submitAgenticResult, V1AssertionFailure } from "../src/engine/runner-v1.js";
import { nowISO } from "../src/util.js";

function mkDef(steps: V1StepDef[], schemas?: Record<string, unknown>): WorkflowV1Def {
  return {
    format: V1_FORMAT_MARKER,
    name: "assert-env-test",
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
      ...(schemas ?? {}),
    } as WorkflowV1Def["schemas"],
    input: "Input",
    output: "Output",
    steps,
  };
}

/**
 * `fetch` yields the pair the analysis is about; `analyze` is asked whether a relation
 * holds between exactly those two. The pair lives in an earlier step, which is why the
 * assertion needs `env:` — `STEP_OUTPUT` alone cannot reach it.
 */
function pairWorkflow(script: string): WorkflowV1Def {
  return mkDef(
    [
      {
        id: "fetch",
        type: "programmatic",
        actions: [
          {
            name: "load",
            js: 'return { entity_a_id: "e1", entity_b_id: "e2" };',
          },
        ],
        required_output: "Pair",
      } as unknown as V1StepDef,
      {
        id: "analyze",
        type: "agentic",
        instruction: "decide whether the two entities are related",
        required_output: "Analysis",
        assertions: [
          {
            field: "has_relation",
            op: "script",
            value: script,
            env: {
              PAIR_A: "{fetch.entity_a_id}",
              PAIR_B: "{fetch.entity_b_id}",
            },
          },
        ],
      } as unknown as V1StepDef,
    ],
    {
      Pair: {
        type: "object",
        properties: { entity_a_id: { type: "string" }, entity_b_id: { type: "string" } },
        required: ["entity_a_id", "entity_b_id"],
      },
      Analysis: {
        type: "object",
        properties: {
          has_relation: { type: "boolean" },
          subject_hint: { type: "string" },
          object_hint: { type: "string" },
        },
        required: ["has_relation"],
      },
    },
  );
}

/** The shape ontology-fixer wants: gate on one field, check siblings and the pair. */
const PAIR_SCRIPT = `node -e '
  const ctx = JSON.parse(process.env.STEP_OUTPUT || "{}");
  if (ctx.has_relation !== true) process.exit(0);
  const errors = [];
  if (!/^entity:/.test(ctx.subject_hint || "")) errors.push("subject_hint must be entity:<id>");
  if (!/^entity:/.test(ctx.object_hint || "")) errors.push("object_hint must be entity:<id>");
  const a = process.env.PAIR_A, b = process.env.PAIR_B;
  const s = (ctx.subject_hint || "").replace(/^entity:/, "");
  const o = (ctx.object_hint || "").replace(/^entity:/, "");
  if (!((s === a && o === b) || (s === b && o === a))) {
    errors.push("subject/object must match the input pair (" + a + ", " + b + ")");
  }
  if (errors.length) { console.error(errors.join("\\n")); process.exit(1); }
'`;

describe("script assertions — STEP_OUTPUT + resolved env", () => {
  it("passes when siblings are well-formed and the pair matches", () => {
    const def = pairWorkflow(PAIR_SCRIPT);
    const state = initialV1State(def, "t1", undefined, {}, nowISO());
    advance(def, state);
    assert.equal(state.current_step_id, "analyze");

    submitAgenticResult(def, state, {
      has_relation: true,
      subject_hint: "entity:e1",
      object_hint: "entity:e2",
    });
    assert.equal(state.steps.analyze.status, "completed");
  });

  it("rejects a sibling that STEP_OUTPUT exposes — the check that used to be dead", () => {
    const def = pairWorkflow(PAIR_SCRIPT);
    const state = initialV1State(def, "t2", undefined, {}, nowISO());
    advance(def, state);

    assert.throws(
      () =>
        submitAgenticResult(def, state, {
          has_relation: true,
          subject_hint: "User", // no entity: prefix
          object_hint: "entity:e2",
        }),
      (e: unknown) => {
        assert.ok(e instanceof V1AssertionFailure);
        assert.match(e.message, /subject_hint must be entity/);
        return true;
      },
    );
    // reverted so the agent can retry
    assert.notEqual(state.steps.analyze.status, "completed");
  });

  it("resolves {step.field} env from an earlier step — pair mismatch is caught", () => {
    const def = pairWorkflow(PAIR_SCRIPT);
    const state = initialV1State(def, "t3", undefined, {}, nowISO());
    advance(def, state);

    assert.throws(
      () =>
        submitAgenticResult(def, state, {
          has_relation: true,
          subject_hint: "entity:e1",
          object_hint: "entity:e9", // not the pair fetch handed us
        }),
      (e: unknown) => {
        assert.ok(e instanceof V1AssertionFailure);
        // the message must name the real ids, proving env resolved rather than
        // silently becoming undefined
        assert.match(e.message, /input pair \(e1, e2\)/);
        return true;
      },
    );
  });

  it("the gate still short-circuits — has_relation false skips the sibling checks", () => {
    const def = pairWorkflow(PAIR_SCRIPT);
    const state = initialV1State(def, "t4", undefined, {}, nowISO());
    advance(def, state);

    submitAgenticResult(def, state, { has_relation: false });
    assert.equal(state.steps.analyze.status, "completed");
  });

  it("an unresolvable env reference does not crash the runner", () => {
    const def = mkDef(
      [
        {
          id: "analyze",
          type: "agentic",
          instruction: "x",
          required_output: "Analysis",
          assertions: [
            {
              field: "has_relation",
              op: "script",
              value: `[ -z "$MISSING" ]`,
              env: { MISSING: "{nosuchstep.field}" },
            },
          ],
        } as unknown as V1StepDef,
      ],
      {
        Analysis: {
          type: "object",
          properties: { has_relation: { type: "boolean" } },
          required: ["has_relation"],
        },
      },
    );
    const state = initialV1State(def, "t5", undefined, {}, nowISO());
    advance(def, state);
    // empty string, not a thrown ContextResolutionError
    submitAgenticResult(def, state, { has_relation: true });
    assert.equal(state.steps.analyze.status, "completed");
  });
});
