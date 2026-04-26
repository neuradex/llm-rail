import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendCommandLog,
  readCommandLog,
} from "../src/audit/command-log.js";
import { evaluatePolicy } from "../src/engine/policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

interface RunResult { status: number; stdout: string; stderr: string }

function makeProject(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-p2r-"));
  fs.mkdirSync(path.join(dir, "workflows"), { recursive: true });
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeWorkflow(projectDir: string, name: string, body: string): void {
  const dir = path.join(projectDir, "workflows", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workflow.yml"), body);
}

function runCli(projectDir: string, args: string[]): RunResult {
  const env = { ...process.env, LRAIL_DATA: path.join(projectDir, ".llm-rail") };
  const res: SpawnSyncReturns<string> = spawnSync("node", [CLI, ...args], {
    cwd: projectDir, env, encoding: "utf-8", timeout: 30_000,
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function aliasOf(projectDir: string, workflowName: string): string {
  const dir = path.join(projectDir, ".llm-rail", workflowName);
  const ids = fs.readdirSync(dir);
  return fs.readFileSync(path.join(dir, ids[0], "alias"), "utf-8").trim();
}

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

// ── Audit events: full enumeration ──

describe("audit — step_auto_completed + step_started + workflow_completed (programmatic)", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "auto", `
format: v1
name: auto
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
steps:
  - id: a
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
  - id: b
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("emits created -> step_auto_completed -> step_auto_completed -> workflow_completed", () => {
    runCli(p.dir, ["wf", "auto", "create"]);
    const alias = aliasOf(p.dir, "auto");
    runCli(p.dir, [alias, "start"]);

    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "auto"))[0];
    const audit = fs.readFileSync(
      path.join(p.dir, ".llm-rail", "auto", id, "audit.jsonl"),
      "utf-8",
    );
    const events = audit.trim().split("\n").map((l) => JSON.parse(l));
    const types = events.map((e) => e.event);
    assert.ok(types.includes("created"));
    assert.equal(types.filter((t) => t === "step_auto_completed").length, 2);
    assert.ok(types.includes("workflow_completed"));
    // Each step_auto_completed has step_id
    for (const e of events.filter((e) => e.event === "step_auto_completed")) {
      assert.ok(e.step_id, `step_id missing on ${JSON.stringify(e)}`);
    }
  });
});

describe("audit — step_started + step_rejected (agentic schema fail)", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "rej", `
format: v1
name: rej
schemas:
  Input: { type: object }
  Output:
    type: object
    properties: { v: { type: integer } }
    required: [v]
input: Input
output: Output
steps:
  - id: ask
    type: agentic
    instruction: produce
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("step_started precedes step_rejected, rejected entry carries errors[]", () => {
    runCli(p.dir, ["wf", "rej", "create"]);
    const alias = aliasOf(p.dir, "rej");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "next", "--result", '{"v":"oops"}']);
    assert.equal(r.status, 1);

    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "rej"))[0];
    const events = fs
      .readFileSync(path.join(p.dir, ".llm-rail", "rej", id, "audit.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    const rejected = events.find((e) => e.event === "step_rejected");
    assert.ok(rejected);
    assert.equal(rejected.step_id, "ask");
    assert.ok(Array.isArray(rejected.data.errors));
    assert.ok(rejected.data.errors.length > 0);
  });
});

describe("audit — step_reset entry per cascaded step", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "rst2", `
format: v1
name: rst2
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
steps:
  - id: a
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
  - id: b
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
  - id: c
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("reset emits one step_reset per cascaded step", () => {
    runCli(p.dir, ["wf", "rst2", "create"]);
    const alias = aliasOf(p.dir, "rst2");
    runCli(p.dir, [alias, "start"]);
    runCli(p.dir, [alias, "reset", "b"]);

    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "rst2"))[0];
    const events = fs
      .readFileSync(path.join(p.dir, ".llm-rail", "rst2", id, "audit.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    const resets = events.filter((e) => e.event === "step_reset");
    const ids = new Set(resets.map((e) => e.step_id));
    assert.ok(ids.has("b"));
    assert.ok(ids.has("c"));
    assert.equal(ids.has("a"), false);
  });
});

describe("audit — workflow_error carries message", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "boom", `
format: v1
name: boom
schemas:
  Input: { type: object }
  Output:
    type: object
    properties: { v: { type: integer } }
    required: [v]
input: Input
output: Output
steps:
  - id: bad
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return { v: 'not-int' };" }]
`.trim());
  });
  after(() => p.cleanup());

  it("schema-failed programmatic step emits workflow_error with message", () => {
    runCli(p.dir, ["wf", "boom", "create"]);
    const alias = aliasOf(p.dir, "boom");
    runCli(p.dir, [alias, "start"]);

    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "boom"))[0];
    const events = fs
      .readFileSync(path.join(p.dir, ".llm-rail", "boom", id, "audit.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const err = events.find((e) => e.event === "workflow_error");
    assert.ok(err);
    assert.ok(typeof err.data.message === "string");
    assert.match(err.data.message, /failed validation/);
  });
});

describe("audit — tool_called success + tool_failed", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "tt", `
format: v1
name: tt
schemas:
  Input: { type: object }
  Output: { type: object }
input: Input
output: Output
tools:
  ok:
    actions:
      - { name: g, description: g, js: "return { v: 1 };" }
  bad:
    actions:
      - { name: g, description: g, js: "throw new Error('x');" }
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("tool_called includes tool/args/output; tool_failed includes tool/error", () => {
    runCli(p.dir, ["wf", "tt", "create"]);
    const alias = aliasOf(p.dir, "tt");
    runCli(p.dir, [alias, "start"]);
    runCli(p.dir, [alias, "tool", "ok"]);
    runCli(p.dir, [alias, "tool", "bad"]);

    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "tt"))[0];
    const events = fs
      .readFileSync(path.join(p.dir, ".llm-rail", "tt", id, "audit.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    const called = events.find((e) => e.event === "tool_called");
    assert.ok(called);
    assert.equal(called.data.tool, "ok");
    assert.deepEqual(called.data.output, { v: 1 });

    const failed = events.find((e) => e.event === "tool_failed");
    assert.ok(failed);
    assert.equal(failed.data.tool, "bad");
    assert.match(failed.data.error, /x/);
  });
});

// ── global command.jsonl ──

describe("global command-log — append + read + denied/error flags", () => {
  it("appends entries with source/denied/error flags and roundtrips them", () => {
    withDataDir(() => {
      appendCommandLog(["echo", "hi"], "cli");
      appendCommandLog(["rm", "-rf", "/"], "hook", true /* denied */);
      appendCommandLog(["bad-cmd"], "instance", false, true /* error */);

      const entries = readCommandLog();
      assert.equal(entries.length, 3);
      assert.equal(entries[0].source, "cli");
      assert.equal(entries[0].command, "echo hi");
      assert.equal(entries[0].denied, undefined);

      assert.equal(entries[1].source, "hook");
      assert.equal(entries[1].denied, true);

      assert.equal(entries[2].source, "instance");
      assert.equal(entries[2].error, true);
    });
  });

  it("readCommandLog returns [] when log file does not exist", () => {
    withDataDir(() => {
      assert.deepEqual(readCommandLog(), []);
    });
  });

  it("readCommandLog skips malformed lines without throwing", () => {
    withDataDir((dir) => {
      const p = path.join(dir, "command.jsonl");
      fs.writeFileSync(p, [
        JSON.stringify({ timestamp: "x", command: "ok", cwd: ".", source: "cli" }),
        "{not-json",
        JSON.stringify({ timestamp: "y", command: "ok2", cwd: ".", source: "cli" }),
      ].join("\n"));
      const entries = readCommandLog();
      assert.equal(entries.length, 2);
    });
  });
});

describe("CLI — global lrail log + --raw mode", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "gl", `
format: v1
name: gl
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("global log shows hook source for `lrail bash` invocations", () => {
    runCli(p.dir, ["bash", "echo hello-from-global"]);
    const r = runCli(p.dir, ["log"]);
    assert.equal(r.status, 0);
    // Expect AGENT tag (source=hook → " AGENT ")
    assert.match(r.stdout, /AGENT/);
    assert.match(r.stdout, /echo hello-from-global/);
  });

  it("--raw mode emits TSV-like lines instead of colored output", () => {
    runCli(p.dir, ["bash", "echo raw-mode"]);
    const r = runCli(p.dir, ["log", "--raw"]);
    assert.equal(r.status, 0);
    // raw format: timestamp\tsource\tstatus\tcommand
    assert.match(r.stdout, /^\d{4}-\d{2}-\d{2}T.*\thook\tok\techo raw-mode/m);
  });

  it("--raw + denied command shows status=denied", () => {
    // Need a project policy that denies; write lrail.yml
    fs.writeFileSync(path.join(p.dir, "lrail.yml"), `
policy:
  mode: enforce
  default: deny
  rules:
    - effect: allow
      commands: ["echo *"]
`.trim());
    runCli(p.dir, ["bash", "rm -rf /tmp/never-exec"]);
    const r = runCli(p.dir, ["log", "--raw"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\tdenied\t.*rm -rf/);
  });
});

// ── Policy edges ──

describe("policy — line continuation evasion", () => {
  it("normalizes backslash+newline before matching deny rules", () => {
    const policy = {
      mode: "enforce" as const,
      default: "allow" as const,
      rules: [
        { effect: "deny" as const, commands: ["rm -rf *"] },
      ],
    };
    // Without normalization, this would be "rm -rf\n  *" and miss the rule
    const evasive = "rm -rf\\\n  *";
    const r = evaluatePolicy(policy, evasive);
    assert.equal(r.allowed, false);
  });
});

describe("policy — enforce + default allow", () => {
  it("allows commands not matching any rule when default=allow", () => {
    const policy = {
      mode: "enforce" as const,
      default: "allow" as const,
      rules: [
        { effect: "deny" as const, commands: ["rm -rf *"] },
      ],
    };
    assert.equal(evaluatePolicy(policy, "ls /tmp").allowed, true);
    assert.equal(evaluatePolicy(policy, "rm -rf /").allowed, false);
  });
});

describe("policy — empty rules array", () => {
  it("enforce mode with no rules + default=allow allows everything", () => {
    const policy = {
      mode: "enforce" as const,
      default: "allow" as const,
      rules: [],
    };
    assert.equal(evaluatePolicy(policy, "anything").allowed, true);
  });
  it("enforce mode with no rules + default=deny denies everything", () => {
    const policy = {
      mode: "enforce" as const,
      default: "deny" as const,
      rules: [],
    };
    assert.equal(evaluatePolicy(policy, "anything").allowed, false);
  });
});

describe("policy — project lrail.yml blocks before workflow policy", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    fs.writeFileSync(path.join(p.dir, "lrail.yml"), `
policy:
  mode: enforce
  default: deny
  rules:
    - effect: deny
      commands: ["rm *"]
    - effect: allow
      commands: ["echo *"]
`.trim());
    writeWorkflow(p.dir, "permissive", `
format: v1
name: permissive
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
policy:
  mode: trail
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("project policy denial wins even if workflow policy is permissive", () => {
    runCli(p.dir, ["wf", "permissive", "create"]);
    const alias = aliasOf(p.dir, "permissive");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "bash", "rm /tmp/whatever-fake"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Policy denied/);
  });

  it("project policy allows pass-through to workflow execution", () => {
    runCli(p.dir, ["wf", "permissive", "create"]);
    const ids = fs.readdirSync(path.join(p.dir, ".llm-rail", "permissive")).sort();
    const id = ids[ids.length - 1];
    const alias = fs.readFileSync(path.join(p.dir, ".llm-rail", "permissive", id, "alias"), "utf-8").trim();
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "bash", "echo allowed"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /allowed/);
  });
});

describe("policy — flat (legacy) lrail.yml format normalization", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    // Flat format: mode/rules at top level (no policy: nesting)
    fs.writeFileSync(path.join(p.dir, "lrail.yml"), `
mode: enforce
default: deny
rules:
  - effect: allow
    commands: ["echo *"]
`.trim());
  });
  after(() => p.cleanup());

  it("loadLrailConfig normalizes flat to { policy: ... } and policy is honored", () => {
    const ok = runCli(p.dir, ["bash", "echo flat-ok"]);
    assert.equal(ok.status, 0, ok.stderr);

    const denied = runCli(p.dir, ["bash", "rm -rf /tmp/fake"]);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Policy denied/);
  });
});
