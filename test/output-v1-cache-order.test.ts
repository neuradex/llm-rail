import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatV1AgenticStart, formatV1Rejection } from "../src/engine/output-v1.js";
import type { V1InstanceState } from "../src/engine/state-v1.js";
import type { V1AgenticStep, WorkflowV1Def } from "../src/types-v1.js";
import { nowISO } from "../src/util.js";

// The agentic prompt is billed on every turn of every workflow loop. Providers
// serve repeat input from a *prefix* cache, so any per-run value rendered above
// the instruction makes the entire instruction — kilobytes of constant text —
// uncacheable and re-billed at full price. These tests pin the ordering so a
// well-meaning readability edit can't silently reintroduce that cost.

const INSTRUCTION = "Summarize the segment.\n\nEPISODES:\n{episodes}\n\nLanguage: {{languages}}";

const def: WorkflowV1Def = {
  format: "v1",
  name: "demo",
  schemas: {
    Out: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
  tools: {
    "read-episodes": { description: "page through episodes", params: { offset: { type: "number", required: true } } },
  },
  steps: [
    {
      id: "analyze",
      type: "agentic",
      description: "Read the segment",
      instruction: INSTRUCTION,
      required_output: "Out",
    } as V1AgenticStep,
  ],
} as unknown as WorkflowV1Def;

const step = def.steps[0] as V1AgenticStep;

function mkState(alias: string): V1InstanceState {
  return {
    id: `id-${alias}`,
    workflow_name: "demo",
    format: "v1",
    status: "in_progress",
    created_at: nowISO(),
    updated_at: nowISO(),
    current_step_id: "analyze",
    alias,
    input: { languages: "Korean" },
    steps: {},
  } as unknown as V1InstanceState;
}

/** Longest common prefix — what a provider prefix cache could actually serve. */
function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

describe("agentic prompt block order (prefix-cache economics)", () => {
  it("renders the instruction before the per-run context block", () => {
    const out = formatV1AgenticStart(def, mkState("abc"), step, {
      episodes: "<payload>",
      languages: "Korean",
    });
    const instructionAt = out.indexOf("Summarize the segment.");
    const contextAt = out.indexOf("Context —");
    assert.ok(instructionAt > -1, "instruction must be rendered");
    assert.ok(contextAt > -1, "context block must be rendered");
    assert.ok(
      instructionAt < contextAt,
      "instruction must precede the context block, or it falls outside the cacheable prefix",
    );
  });

  it("keeps the whole instruction inside the prefix shared by two different runs", () => {
    // Two instances of the same step: different alias, different payload —
    // i.e. exactly what consecutive worker dispatches look like.
    const a = formatV1AgenticStart(def, mkState("aaa111"), step, {
      episodes: "episode payload for the first run",
      languages: "Korean",
    });
    const b = formatV1AgenticStart(def, mkState("bbb222"), step, {
      episodes: "a completely different payload for the second run",
      languages: "Korean",
    });

    const shared = commonPrefix(a, b);
    assert.ok(
      shared.includes("Summarize the segment."),
      "instruction text must sit inside the shared prefix",
    );
    assert.ok(
      shared.includes("EPISODES:\n{episodes}"),
      "the full instruction body — not just its first line — must be cacheable",
    );
    assert.ok(
      shared.includes("Required output schema: Out"),
      "schema declaration must be cacheable",
    );
    assert.ok(
      !shared.includes("episode payload for the first run"),
      "per-run values must fall outside the shared prefix",
    );
    assert.ok(!shared.includes("aaa111"), "instance alias must fall outside the shared prefix");
  });

  it("interpolates {{input}} params but leaves {single} placeholders for the context block", () => {
    const out = formatV1AgenticStart(def, mkState("abc"), step, {
      episodes: "<payload>",
      languages: "Korean",
    });
    // {{languages}} resolves; {episodes} intentionally does not — inlining it
    // would duplicate the payload and break the cacheable prefix.
    assert.ok(out.includes("Language: Korean"));
    assert.ok(out.includes("EPISODES:\n{episodes}"));
    assert.ok(out.includes("  episodes: <payload>"), "the value belongs in the context block");
    assert.ok(
      out.includes("{placeholders}"),
      "context header must tell the agent that {names} above map to these values",
    );
  });

  it("puts the alias-bearing tool and submit lines after the static region", () => {
    const out = formatV1AgenticStart(def, mkState("abc"), step, { episodes: "<payload>" });
    const instructionAt = out.indexOf("Summarize the segment.");
    assert.ok(out.indexOf("Available tools:") > instructionAt);
    assert.ok(out.indexOf("lrail abc next --result") > instructionAt);
  });

  it("restates the instruction before the rejection errors", () => {
    const out = formatV1Rejection(mkState("abc"), step, "Out", [
      "title: required field missing",
    ], { episodes: "<payload>" });
    const instructionAt = out.indexOf("Summarize the segment.");
    const errorsAt = out.indexOf("title: required field missing");
    assert.ok(instructionAt > -1 && errorsAt > -1);
    assert.ok(
      instructionAt < errorsAt,
      "restated instruction is constant and must precede the run-specific errors",
    );
  });
});
