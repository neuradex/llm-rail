import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

interface RunResult { status: number; stdout: string; stderr: string }

function makeProject(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-e2e-cs-"));
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

// ── P1-7: create — type coercion + defaults ──

describe("cli e2e — create type coercion", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "typed", `
format: v1
name: typed
schemas:
  Input:
    type: object
    properties:
      n: { type: integer }
      f: { type: number }
      b: { type: boolean }
      s: { type: string }
      o: { type: object }
      a: { type: array }
    required: [n, f, b, s]
  Output: { type: object }
input: Input
output: Output
steps:
  - id: noop
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("coerces integer / number / boolean / string params", () => {
    const r = runCli(p.dir, [
      "wf", "typed", "create",
      "--param", "n=42",
      "--param", "f=3.14",
      "--param", "b=true",
      "--param", "s=hello",
      "--param", `o={"k":1}`,
      "--param", `a=[1,2,3]`,
    ]);
    assert.equal(r.status, 0, r.stderr);
    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "typed"))[0];
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "typed", id, "state.yaml"), "utf-8");
    // YAML may quote 'n' (single-letter that looks special), so allow both
    assert.match(stateRaw, /'?n'?: 42/);
    assert.match(stateRaw, /f: 3\.14/);
    assert.match(stateRaw, /b: true/);
    assert.match(stateRaw, /s: hello/);
    assert.match(stateRaw, /k: 1/);
  });
});

describe("cli e2e — create applies schema defaults", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "defaults", `
format: v1
name: defaults
schemas:
  Input:
    type: object
    properties:
      mode: { type: string, default: fast }
      n: { type: integer, default: 5 }
    required: []
  Output: { type: object }
input: Input
output: Output
steps:
  - id: noop
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("fills defaults when --param is not provided", () => {
    const r = runCli(p.dir, ["wf", "defaults", "create"]);
    assert.equal(r.status, 0, r.stderr);
    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "defaults"))[0];
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "defaults", id, "state.yaml"), "utf-8");
    assert.match(stateRaw, /mode: fast/);
    assert.match(stateRaw, /'?n'?: 5/);
  });

  it("explicit --param overrides default", () => {
    const r = runCli(p.dir, ["wf", "defaults", "create", "--param", "mode=slow"]);
    assert.equal(r.status, 0, r.stderr);
    const dirs = fs.readdirSync(path.join(p.dir, ".llm-rail", "defaults")).sort();
    const id = dirs[dirs.length - 1];
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "defaults", id, "state.yaml"), "utf-8");
    assert.match(stateRaw, /mode: slow/);
  });
});

describe("cli e2e — create rejects malformed --param", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "noop", `
format: v1
name: noop
schemas:
  Input: { type: object }
  Output: { type: object }
input: Input
output: Output
steps:
  - id: x
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("rejects --param without =", () => {
    const r = runCli(p.dir, ["wf", "noop", "create", "--param", "justakey"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Invalid --param format/);
  });

  it("supports = in param value", () => {
    // Adds an unknown key (since schema has no props), but the parser
    // should accept the syntax — schema validation happens after.
    writeWorkflow(p.dir, "noop2", `
format: v1
name: noop2
schemas:
  Input:
    type: object
    properties: { kv: { type: string } }
    required: [kv]
  Output: { type: object }
input: Input
output: Output
steps:
  - id: x
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
    const r = runCli(p.dir, ["wf", "noop2", "create", "--param", "kv=a=b=c"]);
    assert.equal(r.status, 0, r.stderr);
    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "noop2"))[0];
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "noop2", id, "state.yaml"), "utf-8");
    assert.match(stateRaw, /kv: a=b=c/);
  });
});

// ── P1-8: status / query ──

describe("cli e2e — status output", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "stat", `
format: v1
name: stat
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
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("shows status for a fresh and partially-progressed instance", () => {
    runCli(p.dir, ["wf", "stat", "create"]);
    const alias = aliasOf(p.dir, "stat");

    // Fresh
    let r = runCli(p.dir, [alias, "status"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Status:\s+created/);
    assert.match(r.stdout, /\[ \] 1\. a \(programmatic\) — pending/);
    assert.match(r.stdout, /\[ \] 2\. b \(agentic\) — pending/);

    // Start → pause at agentic
    r = runCli(p.dir, [alias, "start"]);
    assert.equal(r.status, 0, r.stderr);
    r = runCli(p.dir, [alias, "status"]);
    assert.match(r.stdout, /\[x\] 1\. a/);
    assert.match(r.stdout, /\[>\] 2\. b/);
  });
});

describe("cli e2e — query produces JSON", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "qy", `
format: v1
name: qy
schemas:
  Input: { type: object }
  Out: { type: object, properties: { tag: { type: string } }, required: [tag] }
  Output: { type: object }
input: Input
output: Output
steps:
  - id: ask
    type: agentic
    instruction: produce a tag
    required_output: Out
  - id: tail
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("emits valid JSON with expected keys for an agentic step", () => {
    runCli(p.dir, ["wf", "qy", "create"]);
    const alias = aliasOf(p.dir, "qy");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "query"]);
    assert.equal(r.status, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.format, "v1");
    assert.equal(j.step.id, "ask");
    assert.equal(j.step.type, "agentic");
    assert.equal(j.step.instruction, "produce a tag");
    assert.equal(j.step.required_output_schema, "Out");
    assert.deepEqual(j.expected_output_fields, ["tag"]);
    assert.match(j.submit_command, /next --result/);
  });
});

// ── P1-9: reset ──

describe("cli e2e — reset", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "rst", `
format: v1
name: rst
schemas:
  Input: { type: object }
  Mid: { type: object, properties: { v: { type: integer } }, required: [v] }
  Output: { type: object }
input: Input
output: Output
steps:
  - id: a
    type: programmatic
    required_output: Mid
    actions: [{ name: x, description: x, js: "return { v: 1 };" }]
  - id: b
    type: programmatic
    required_output: Mid
    actions: [{ name: x, description: x, js: "return { v: 2 };" }]
  - id: c
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("cascades from the reset target through end of workflow", () => {
    runCli(p.dir, ["wf", "rst", "create"]);
    const alias = aliasOf(p.dir, "rst");
    runCli(p.dir, [alias, "start"]);

    // All completed
    let st = runCli(p.dir, [alias, "status"]).stdout;
    assert.match(st, /Status:\s+completed/);

    // Reset 'b' — cascades to c, leaves a alone, instance back to in_progress
    const r = runCli(p.dir, [alias, "reset", "b"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Reset: b/);
    assert.match(r.stdout, /Cascade: c/);
    st = runCli(p.dir, [alias, "status"]).stdout;
    assert.match(st, /Status:\s+in_progress/);
    assert.match(st, /\[x\] 1\. a/);
    assert.match(st, /\[ \] 2\. b/);
    assert.match(st, /\[ \] 3\. c/);
  });

  it("rejects unknown step id with a clear error", () => {
    runCli(p.dir, ["wf", "rst", "create"]);
    const dirs = fs.readdirSync(path.join(p.dir, ".llm-rail", "rst")).sort();
    const id = dirs[dirs.length - 1];
    const alias = fs.readFileSync(path.join(p.dir, ".llm-rail", "rst", id, "alias"), "utf-8").trim();
    const r = runCli(p.dir, [alias, "reset", "nonexistent"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not found/);
  });
});

// ── P1-10: tool — failure / unknown / accumulation ──

describe("cli e2e — tool unknown / failure / accumulation", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "tools", `
format: v1
name: tools
schemas:
  Input: { type: object }
  Out: { type: object, properties: { a: { type: string }, b: { type: string } }, required: [a, b] }
  Output: { type: object }
input: Input
output: Output
tools:
  good:
    description: returns a value
    actions:
      - { name: ok, description: ok, js: "return { value: 'ok' };" }
  boom:
    description: always fails
    actions:
      - { name: bad, description: bad, js: "throw new Error('kapow');" }
  needy:
    description: requires a param
    params:
      who: { type: string, required: true }
    actions:
      - { name: g, description: g, js: "return { greeting: 'hi ' + context.who };" }
steps:
  - id: ask
    type: agentic
    instruction: collect tool outputs and submit
    required_output: Out
    context_in:
      a: { from: "{_tools.good.value}", default: "" }
      b: { from: "{_tools.needy.greeting}", default: "" }
`.trim());
  });
  after(() => p.cleanup());

  it("errors on unknown tool name and lists available", () => {
    runCli(p.dir, ["wf", "tools", "create"]);
    const alias = aliasOf(p.dir, "tools");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "tool", "ghost"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Tool "ghost" not found/);
    assert.match(r.stderr, /Available: .*good.*boom.*needy/);
  });

  it("rejects missing required param", () => {
    runCli(p.dir, ["wf", "tools", "create"]);
    const dirs = fs.readdirSync(path.join(p.dir, ".llm-rail", "tools")).sort();
    const id = dirs[dirs.length - 1];
    const alias = fs.readFileSync(path.join(p.dir, ".llm-rail", "tools", id, "alias"), "utf-8").trim();
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "tool", "needy"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Missing required param: who/);
  });

  it("captures js failure and writes tool_failed audit entry", () => {
    runCli(p.dir, ["wf", "tools", "create"]);
    const dirs = fs.readdirSync(path.join(p.dir, ".llm-rail", "tools")).sort();
    const id = dirs[dirs.length - 1];
    const alias = fs.readFileSync(path.join(p.dir, ".llm-rail", "tools", id, "alias"), "utf-8").trim();
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "tool", "boom"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Tool 'boom' failed/);

    const audit = fs.readFileSync(
      path.join(p.dir, ".llm-rail", "tools", id, "audit.jsonl"),
      "utf-8",
    );
    const events = audit.trim().split("\n").map((l) => JSON.parse(l).event);
    assert.ok(events.includes("tool_failed"));
  });

  it("accumulates multiple tool calls under _tools without losing prior results", () => {
    runCli(p.dir, ["wf", "tools", "create"]);
    const dirs = fs.readdirSync(path.join(p.dir, ".llm-rail", "tools")).sort();
    const id = dirs[dirs.length - 1];
    const alias = fs.readFileSync(path.join(p.dir, ".llm-rail", "tools", id, "alias"), "utf-8").trim();
    runCli(p.dir, [alias, "start"]);

    const r1 = runCli(p.dir, [alias, "tool", "good"]);
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = runCli(p.dir, [alias, "tool", "needy", "--args", '{"who":"world"}']);
    assert.equal(r2.status, 0, r2.stderr);

    const stateRaw = fs.readFileSync(
      path.join(p.dir, ".llm-rail", "tools", id, "state.yaml"),
      "utf-8",
    );
    // _tools bucket holds both
    assert.match(stateRaw, /_tools:/);
    assert.match(stateRaw, /good:[\s\S]*value: ok/);
    assert.match(stateRaw, /needy:[\s\S]*greeting: hi world/);
  });
});

// ── P1-11: validate / compile / graph CLI flags ──

describe("cli e2e — validate / compile / graph / show / summary", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "demo", `
format: v1
name: demo
description: demo wf
phase: dev
schemas:
  Input: { type: object }
  Output: { type: object, properties: { v: { type: integer } }, required: [v] }
input: Input
output: Output
steps:
  - id: x
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return { v: 1 };" }]
`.trim());
  });
  after(() => p.cleanup());

  it("validate succeeds and aliases compile", () => {
    const r = runCli(p.dir, ["wf", "demo", "validate"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /compiled successfully/);
  });

  it("compile reports step types", () => {
    const r = runCli(p.dir, ["wf", "demo", "compile"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /1 programmatic/);
  });

  it("graph --json emits structured JSON with required keys", () => {
    const r = runCli(p.dir, ["wf", "demo", "graph", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const g = JSON.parse(r.stdout);
    assert.equal(g.format, "v1");
    assert.equal(g.name, "demo");
    assert.deepEqual(g.nodes.map((n: { id: string }) => n.id), ["x"]);
    assert.ok(Array.isArray(g.control_edges));
    assert.ok(Array.isArray(g.data_edges));
    assert.ok(Array.isArray(g.input_refs));
  });

  it("graph without --json prints usage to stderr", () => {
    const r = runCli(p.dir, ["wf", "demo", "graph"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Usage:.*--json/);
  });

  it("show prints the YAML and rejects --variant", () => {
    let r = runCli(p.dir, ["wf", "demo", "show"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /name: demo/);
    r = runCli(p.dir, ["wf", "demo", "show", "--variant", "foo"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /v1 workflows do not yet support variants/);
  });

  it("summary prints colored output with pipeline", () => {
    const r = runCli(p.dir, ["wf", "demo", "summary"]);
    assert.equal(r.status, 0);
    // Strip ANSI for matching
    const clean = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(clean, /demo\s+dev/);
    assert.match(clean, /Pipeline:/);
  });
});

// ── P1-12: migrate edges ──

describe("cli e2e — migrate refuses to overwrite", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    fs.writeFileSync(
      path.join(p.dir, "workflows", "old.yml"),
      `
name: old
params:
  msg: { type: string, required: true }
steps:
  - id: do
    type: programmatic
    required_output: [out]
    actions:
      - { js: "return { out: context.msg };" }
`.trim(),
    );
  });
  after(() => p.cleanup());

  it("first migrate succeeds, second migrate refuses to overwrite", () => {
    const r1 = runCli(p.dir, ["wf", "old", "migrate"]);
    assert.equal(r1.status, 0, r1.stderr);
    const expected = path.join(p.dir, "workflows", "old.migrated.yml");
    assert.ok(fs.existsSync(expected));
    const r2 = runCli(p.dir, ["wf", "old", "migrate"]);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /Refusing to overwrite/);
  });

  it("--dry-run prints to stdout and does not write file", () => {
    fs.writeFileSync(
      path.join(p.dir, "workflows", "fresh.yml"),
      `
name: fresh
steps:
  - id: do
    type: programmatic
    actions:
      - { js: "return { out: 1 };" }
`.trim(),
    );
    const r = runCli(p.dir, ["wf", "fresh", "migrate", "--dry-run"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /format: v1/);
    assert.ok(!fs.existsSync(path.join(p.dir, "workflows", "fresh.migrated.yml")));
  });

  it("refuses to migrate a file already in v1 format", () => {
    fs.writeFileSync(
      path.join(p.dir, "workflows", "alreadyv1.yml"),
      `format: v1
name: alreadyv1
schemas:
  Input: { type: object }
  Output: { type: object }
input: Input
output: Output
steps:
  - id: x
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`,
    );
    const r = runCli(p.dir, ["wf", "alreadyv1", "migrate"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already a v1 workflow/);
  });
});

describe("cli e2e — migrate folds structural validation into schema", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    fs.writeFileSync(
      path.join(p.dir, "workflows", "fold.yml"),
      `
name: fold
steps:
  - id: do
    type: agentic
    instruction: produce
    required_output: [items, count]
    validation:
      - { field: items, op: type, value: array }
      - { field: items, op: min_length, value: 1 }
      - { field: count, op: type, value: integer }
      - { field: count, op: min, value: 0 }
`.trim(),
    );
  });
  after(() => p.cleanup());

  it("structural rules become schema keywords (minItems, type, minimum)", () => {
    const r = runCli(p.dir, ["wf", "fold", "migrate", "--dry-run"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /minItems:\s+1/);
    assert.match(r.stdout, /minimum:\s+0/);
  });
});

// ── P1: list / instances / unknown command ──

describe("cli e2e — list/instances and unknown command", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "wf1", `
format: v1
name: wf1
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
steps:
  - id: x
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("wf list shows registered workflows", () => {
    const r = runCli(p.dir, ["wf", "list"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /wf1.*\[draft\]/);
  });

  it("wf instances --status filter works", () => {
    runCli(p.dir, ["wf", "wf1", "create"]);
    const all = runCli(p.dir, ["wf", "instances"]);
    assert.equal(all.status, 0);
    assert.match(all.stdout, /wf1/);
    const filtered = runCli(p.dir, ["wf", "instances", "--status", "in_progress"]);
    assert.equal(filtered.status, 0);
    assert.match(filtered.stdout, /No instances|wf1.*in_progress|wf1.*created/);
  });

  it("unknown target prints a helpful error", () => {
    const r = runCli(p.dir, ["totally-unknown-thing"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unknown command or instance/);
  });
});

// ── start: forbids start on completed/error ──

describe("cli e2e — start guards", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "done", `
format: v1
name: done
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
steps:
  - id: x
    type: programmatic
    required_output: Output
    actions: [{ name: x, description: x, js: "return {};" }]
`.trim());
  });
  after(() => p.cleanup());

  it("rejects start on already-completed instance", () => {
    runCli(p.dir, ["wf", "done", "create"]);
    const alias = aliasOf(p.dir, "done");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "start"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already completed/);
  });
});

// ── next: malformed JSON ──

describe("cli e2e — next malformed JSON", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "ag", `
format: v1
name: ag
schemas:
  Input: { type: object }
  Output: { type: object, properties: { v: { type: integer } }, required: [v] }
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

  it("rejects malformed JSON in --result with a clear message", () => {
    runCli(p.dir, ["wf", "ag", "create"]);
    const alias = aliasOf(p.dir, "ag");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "next", "--result", "{not-json"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Invalid JSON/);
  });
});
