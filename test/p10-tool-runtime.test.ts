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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-p10-"));
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

// ── Tool js context surfaces input + step outputs + args ──

describe("tool — js context exposes workflow input + step outputs + tool args", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "ctx", `
format: v1
name: ctx
schemas:
  Input:
    type: object
    properties: { user: { type: string } }
    required: [user]
  Stage:
    type: object
    properties: { tag: { type: string } }
    required: [tag]
  Output: { type: object }
input: Input
output: Output
tools:
  echo:
    params:
      arg: { type: string, required: true }
    actions:
      - name: e
        description: echoes context fields seen at tool runtime
        js: |
          return {
            saw_user: context.user,
            saw_stage_tag: context.stage && context.stage.tag,
            saw_arg: context.arg,
          };
steps:
  - id: stage
    type: programmatic
    required_output: Stage
    actions: [{ name: x, description: x, js: "return { tag: 'staged' };" }]
  - id: ask
    type: agentic
    instruction: invoke tool then submit
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("context inside tool js sees input.user, prior step output (stage.tag), and tool args.arg", () => {
    runCli(p.dir, ["wf", "ctx", "create", "--param", "user=alice"]);
    const alias = aliasOf(p.dir, "ctx");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "tool", "echo", "--args", '{"arg":"hello"}']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.saw_user, "alice");
    assert.equal(out.saw_stage_tag, "staged");
    assert.equal(out.saw_arg, "hello");
  });
});

// ── Tool with optional params ──

describe("tool — optional params", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "opt", `
format: v1
name: opt
schemas:
  Input: { type: object }
  Output: { type: object }
input: Input
output: Output
tools:
  greet:
    params:
      name: { type: string, required: true }
      style: { type: string }
    actions:
      - name: g
        description: greet
        js: |
          const style = context.style || 'friendly';
          return { greeting: style + ': hello, ' + context.name };
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("omitting an optional param works", () => {
    runCli(p.dir, ["wf", "opt", "create"]);
    const alias = aliasOf(p.dir, "opt");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "tool", "greet", "--args", '{"name":"world"}']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.greeting, "friendly: hello, world");
  });

  it("supplying an optional param overrides the tool's local default", () => {
    runCli(p.dir, ["wf", "opt", "create"]);
    const ids = fs.readdirSync(path.join(p.dir, ".llm-rail", "opt")).sort();
    const id = ids[ids.length - 1];
    const alias = fs.readFileSync(path.join(p.dir, ".llm-rail", "opt", id, "alias"), "utf-8").trim();
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "tool", "greet", "--args", '{"name":"bob","style":"formal"}']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.greeting, "formal: hello, bob");
  });
});

// ── Tool with malformed args JSON ──

describe("tool — malformed --args JSON", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "mj", `
format: v1
name: mj
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
tools:
  any:
    actions:
      - { name: g, description: g, js: "return { ok: true };" }
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("rejects non-JSON --args with a clear error", () => {
    runCli(p.dir, ["wf", "mj", "create"]);
    const alias = aliasOf(p.dir, "mj");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "tool", "any", "--args", "{not-json"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Invalid JSON args/);
  });
});

// ── Tool with synthesized name/description (legacy ActionDef shape) ──

describe("tool — legacy ActionDef coerced into V1ActionDef", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    // tools[].actions in YAML can lack name/description (legacy shape).
    // Tool runtime should synthesize them.
    writeWorkflow(p.dir, "lg", `
format: v1
name: lg
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
tools:
  legacy:
    actions:
      - js: "return { v: 1 };"
      - shell: "echo hello"
        extract: { msg: "msg" }
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("runs without complaining about missing action.name / description", () => {
    runCli(p.dir, ["wf", "lg", "create"]);
    const alias = aliasOf(p.dir, "lg");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "tool", "legacy"]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    // first js returned { v: 1 }, second shell stdout was "hello"
    // (not JSON — extract { msg: "msg" } → silently skips)
    assert.equal(out.v, 1);
  });
});

// ── Tool result accumulation under _tools across calls ──

describe("tool — multiple calls accumulate keys under _tools (verified via state.yaml)", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "acc", `
format: v1
name: acc
schemas:
  Input: { type: object }
  Output: { type: object }
input: Input
output: Output
tools:
  one:
    actions:
      - { name: g, description: g, js: "return { v: 1 };" }
  two:
    actions:
      - { name: g, description: g, js: "return { v: 2 };" }
  three:
    actions:
      - { name: g, description: g, js: "return { v: 3 };" }
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("after 3 distinct tool calls, state.steps._tools.output has all three keys", () => {
    runCli(p.dir, ["wf", "acc", "create"]);
    const alias = aliasOf(p.dir, "acc");
    runCli(p.dir, [alias, "start"]);
    runCli(p.dir, [alias, "tool", "one"]);
    runCli(p.dir, [alias, "tool", "two"]);
    runCli(p.dir, [alias, "tool", "three"]);

    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "acc"))[0];
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "acc", id, "state.yaml"), "utf-8");
    assert.match(stateRaw, /_tools:[\s\S]*one:[\s\S]*v: 1/);
    assert.match(stateRaw, /_tools:[\s\S]*two:[\s\S]*v: 2/);
    assert.match(stateRaw, /_tools:[\s\S]*three:[\s\S]*v: 3/);
  });
});
