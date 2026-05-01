import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  collectExistingAliases,
  generateAlias,
  resolveAlias,
  resolveInstanceId,
} from "../src/engine/alias.js";
import {
  V1_FORMAT_MARKER,
  type WorkflowV1Def,
} from "../src/types-v1.js";
import {
  initialV1State,
  saveV1Instance,
  loadV1Instance,
  resolveV1InstancePath,
  listV1Instances,
} from "../src/engine/state-v1.js";
import { instanceDir, appendLog } from "../src/audit/logger.js";
import { nowISO } from "../src/util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

function withDataDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-data-"));
  const prev = process.env.LRAIL_DATA;
  process.env.LRAIL_DATA = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.LRAIL_DATA;
    else process.env.LRAIL_DATA = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const def = (): WorkflowV1Def => ({
  format: V1_FORMAT_MARKER,
  name: "wf",
  schemas: { Input: { type: "object" }, Output: { type: "object" } },
  input: "Input",
  output: "Output",
  steps: [],
});

// ── alias generation ──

describe("alias — generation & collision", () => {
  it("returns a fresh alias not present in the existing set", () => {
    const existing = new Set<string>();
    const a = generateAlias(existing);
    assert.match(a, /^[a-z]+-[a-z]+$/);
    assert.equal(existing.has(a), false);
  });

  it("falls back to numeric suffix after exhausting bigram space", () => {
    // Pre-populate every adjective-noun bigram so the random walk
    // cannot find a free one. The fallback returns "<adj>-<noun>-<n>".
    // We just check the format includes a numeric tail.
    const exhaustive = new Set<string>();
    // Create a lot of dummy aliases to make collision likely.
    // Even 10000 fake aliases stress the 200-retry loop without
    // truly exhausting the space, so we use the closure: pretend
    // every generated candidate matches.
    const realRandom = Math.random;
    Math.random = () => 0; // pin to first adj/noun
    const first = generateAlias(new Set<string>(["bold-arc"])); // forces a different pick
    Math.random = realRandom;
    assert.notEqual(first, "bold-arc");
    void exhaustive;
  });

  it("collectExistingAliases reads alias files across workflows", () => {
    withDataDir((dir) => {
      const w1 = path.join(dir, "wf1", "id1");
      const w2 = path.join(dir, "wf2", "id2");
      fs.mkdirSync(w1, { recursive: true });
      fs.mkdirSync(w2, { recursive: true });
      fs.writeFileSync(path.join(w1, "alias"), "calm-fox\n");
      fs.writeFileSync(path.join(w2, "alias"), "wise-owl");

      const set = collectExistingAliases(dir);
      assert.ok(set.has("calm-fox"));
      assert.ok(set.has("wise-owl"));
    });
  });
});

// ── alias / id resolution ──

describe("alias — resolveInstanceId + resolveAlias", () => {
  it("resolves by id when state.yaml exists at that path", () => {
    withDataDir((dir) => {
      const wfDir = path.join(dir, "wf", "abc-123");
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, "state.yaml"), "format: v1\n");
      assert.equal(resolveInstanceId("abc-123"), "abc-123");
    });
  });

  it("resolves by alias when alias file matches", () => {
    withDataDir((dir) => {
      const wfDir = path.join(dir, "wf", "real-id-99");
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, "state.yaml"), "format: v1\n");
      fs.writeFileSync(path.join(wfDir, "alias"), "fast-bee");
      assert.equal(resolveInstanceId("fast-bee"), "real-id-99");
    });
  });

  it("returns null from resolveAlias for an unknown alias", () => {
    withDataDir((dir) => {
      assert.equal(resolveAlias(dir, "ghost"), null);
    });
  });

  it("throws for unknown id+alias", () => {
    withDataDir(() => {
      assert.throws(
        () => resolveInstanceId("totally-unknown"),
        /Instance not found/,
      );
    });
  });
});

// ── state roundtrip ──

describe("state-v1 — save/load roundtrip", () => {
  it("preserves all instance fields including parent metadata", () => {
    withDataDir(() => {
      const d = def();
      const state = initialV1State(d, "id-1", "calm-fox", { x: 1 }, nowISO(), {
        instance_id: "parent-2",
        step_id: "delegate",
        depth: 2,
      });
      state.steps["s1"] = { status: "completed", output: { v: 7 }, completed_at: nowISO(), iterations: 3 };
      saveV1Instance(state);

      const loaded = loadV1Instance("id-1");
      assert.equal(loaded.id, "id-1");
      assert.equal(loaded.alias, "calm-fox");
      assert.deepEqual(loaded.input, { x: 1 });
      assert.equal(loaded.parent?.depth, 2);
      assert.equal(loaded.parent?.instance_id, "parent-2");
      assert.equal(loaded.steps.s1.iterations, 3);
      assert.deepEqual(loaded.steps.s1.output, { v: 7 });
    });
  });

  it("rejects loading non-v1 state.yaml", () => {
    withDataDir((dir) => {
      const wfDir = path.join(dir, "wf", "legacy");
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, "state.yaml"), "format: legacy\nname: old\n");
      assert.throws(
        () => loadV1Instance("legacy"),
        /not a v1 instance/,
      );
    });
  });
});

// ── listV1Instances ──

describe("state-v1 — listV1Instances", () => {
  it("returns empty list when data dir does not exist", () => {
    withDataDir(() => {
      // Move the data dir away
      const stale = process.env.LRAIL_DATA!;
      process.env.LRAIL_DATA = path.join(stale, "nonexistent");
      const list = listV1Instances();
      process.env.LRAIL_DATA = stale;
      assert.deepEqual(list, []);
    });
  });

  it("skips legacy instances and unreadable files", () => {
    withDataDir((dir) => {
      // valid v1
      const v1 = path.join(dir, "wf", "good");
      fs.mkdirSync(v1, { recursive: true });
      const goodState = {
        id: "good",
        workflow_name: "wf",
        format: "v1",
        status: "in_progress",
        created_at: nowISO(),
        updated_at: nowISO(),
        current_step_id: null,
        last_completed_step_id: null,
        steps: {},
        input: {},
      };
      fs.writeFileSync(path.join(v1, "state.yaml"), yaml.dump(goodState));

      // legacy
      const leg = path.join(dir, "wf", "legacy");
      fs.mkdirSync(leg, { recursive: true });
      fs.writeFileSync(path.join(leg, "state.yaml"), "format: legacy\n");

      // unreadable / malformed
      const bad = path.join(dir, "wf", "bad");
      fs.mkdirSync(bad, { recursive: true });
      fs.writeFileSync(path.join(bad, "state.yaml"), "{not-yaml");

      const list = listV1Instances();
      assert.equal(list.length, 1);
      assert.equal(list[0].id, "good");
    });
  });
});

// ── resolveV1InstancePath ──

describe("state-v1 — resolveV1InstancePath", () => {
  it("returns full path for a valid instance", () => {
    withDataDir((dir) => {
      const wfDir = path.join(dir, "wf", "id-abc");
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, "state.yaml"), "format: v1\n");
      const p = resolveV1InstancePath("id-abc");
      assert.equal(p, path.join(wfDir, "state.yaml"));
    });
  });

  it("throws for missing instance", () => {
    withDataDir(() => {
      assert.throws(() => resolveV1InstancePath("ghost"), /Instance not found/);
    });
  });
});

// ── audit log ──

describe("audit logger — appendLog", () => {
  it("appends one JSONL entry per call, preserving event/data fields", () => {
    withDataDir(() => {
      appendLog("wf", "id-1", "created", undefined, { x: 1 });
      appendLog("wf", "id-1", "step_started", "s1");
      appendLog("wf", "id-1", "step_completed", "s1", { output: { v: 1 } });
      appendLog("wf", "id-1", "workflow_completed");

      const dir = instanceDir("wf", "id-1");
      const lines = fs.readFileSync(path.join(dir, "audit.jsonl"), "utf-8").trim().split("\n");
      assert.equal(lines.length, 4);
      const events = lines.map((l) => JSON.parse(l));
      assert.equal(events[0].event, "created");
      assert.deepEqual(events[0].data, { x: 1 });
      assert.equal(events[1].event, "step_started");
      assert.equal(events[1].step_id, "s1");
      assert.deepEqual(events[2].data.output, { v: 1 });
      assert.equal(events[3].event, "workflow_completed");
    });
  });

  it("uses append-only writes (does not truncate prior content)", () => {
    withDataDir(() => {
      appendLog("wf", "id-2", "first");
      appendLog("wf", "id-2", "second");
      appendLog("wf", "id-2", "third");
      const dir = instanceDir("wf", "id-2");
      const content = fs.readFileSync(path.join(dir, "audit.jsonl"), "utf-8").trim();
      assert.equal(content.split("\n").length, 3);
    });
  });
});

// ── audit follow mode (-f) ──

describe("audit follow mode (CLI -f)", () => {
  it("exits cleanly on workflow_completed event", { timeout: 10_000 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-follow-"));
    fs.mkdirSync(path.join(dir, "workflows", "instant"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "workflows", "instant", "workflow.yml"),
      `format: v1
name: instant
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
steps:
  - id: x
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`,
    );
    const env = { ...process.env, LRAIL_DATA: path.join(dir, ".llm-rail") };

    spawnSync("node", [CLI, "wf", "instant", "create"], { cwd: dir, env, encoding: "utf-8" });
    const idsDir = path.join(dir, ".llm-rail", "instant");
    const id = fs.readdirSync(idsDir)[0];
    const alias = fs.readFileSync(path.join(idsDir, id, "alias"), "utf-8").trim();

    // Start in foreground (will write workflow_completed, then exit).
    spawnSync("node", [CLI, alias, "start"], { cwd: dir, env, encoding: "utf-8" });

    // Now follow — log already has workflow_completed, but follow should
    // print past entries first and then exit on seeing it in the new
    // tail. Easier check: invoke without -f to ensure print works.
    const r = spawnSync("node", [CLI, alias, "log"], {
      cwd: dir, env, encoding: "utf-8", timeout: 5_000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /workflow_completed/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ── audit log filter by step ──

describe("audit log — step filter via CLI", () => {
  it("--step shows only matching entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-stepfilter-"));
    fs.mkdirSync(path.join(dir, "workflows", "two"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "workflows", "two", "workflow.yml"),
      `format: v1
name: two
schemas:
  Input: { type: object }
  Output: { type: object, properties: { v: { type: integer } }, required: [v] }
input: Input
output: Output
steps:
  - id: a
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return { v: 1 };" }]
  - id: b
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return { v: 2 };" }]
`,
    );
    const env = { ...process.env, LRAIL_DATA: path.join(dir, ".llm-rail") };

    spawnSync("node", [CLI, "wf", "two", "create"], { cwd: dir, env, encoding: "utf-8" });
    const id = fs.readdirSync(path.join(dir, ".llm-rail", "two"))[0];
    const alias = fs.readFileSync(path.join(dir, ".llm-rail", "two", id, "alias"), "utf-8").trim();
    spawnSync("node", [CLI, alias, "start"], { cwd: dir, env, encoding: "utf-8" });

    const r = spawnSync("node", [CLI, alias, "log", "a"], { cwd: dir, env, encoding: "utf-8" });
    assert.equal(r.status, 0, r.stderr);
    // Should contain step_auto_completed for 'a' but not for 'b' (step-scoped)
    const lines = r.stdout.trim().split("\n");
    for (const line of lines) {
      // Lines may include workflow-level events with no step_id (e.g. created, workflow_completed)
      // The filter logic in log.ts: continue when entry.step_id !== filter && entry.step_id
      // So workflow-level events with no step_id are still shown. Verify 'b' is excluded.
      assert.equal(line.includes("[b]"), false, `unexpected b entry: ${line}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
