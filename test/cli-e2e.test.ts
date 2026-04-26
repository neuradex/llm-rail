import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end CLI smoke tests. Each describe() block sets up an isolated
 * project dir under /tmp + a fresh LRAIL_DATA, writes a v1 workflow,
 * then drives the CLI binary the way an agent would. Verifies the
 * happy path, schema rejection, router/call execution, and the most
 * common error messages.
 *
 * Uses the built CLI at dist/cli.js so we exercise the same code path
 * an installed npm consumer would.
 */

const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function makeProject(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-e2e-"));
  fs.mkdirSync(path.join(dir, "workflows"), { recursive: true });
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function writeWorkflow(projectDir: string, name: string, body: string): void {
  const dir = path.join(projectDir, "workflows", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workflow.yml"), body);
}

function runCli(projectDir: string, args: string[]): RunResult {
  const env = {
    ...process.env,
    LRAIL_DATA: path.join(projectDir, ".llm-rail"),
  };
  const res: SpawnSyncReturns<string> = spawnSync("node", [CLI, ...args], {
    cwd: projectDir,
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function aliasOf(projectDir: string, workflowName: string): string {
  const dir = path.join(projectDir, ".llm-rail", workflowName);
  const ids = fs.readdirSync(dir);
  const alias = fs.readFileSync(path.join(dir, ids[0], "alias"), "utf-8").trim();
  return alias;
}

// ── Happy path: programmatic + agentic ──

describe("cli e2e — happy path", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "demo", `
format: v1
name: demo
schemas:
  Input:
    type: object
    properties:
      n: { type: integer, minimum: 0 }
    required: [n]
  Output:
    type: object
    properties:
      label: { type: string, minLength: 1 }
      doubled: { type: integer }
    required: [label, doubled]
  Doubled:
    type: object
    properties: { doubled: { type: integer } }
    required: [doubled]
input: Input
output: Output
steps:
  - id: compute
    type: programmatic
    context_in: { n: "{{n}}" }
    required_output: Doubled
    actions:
      - name: double
        description: n * 2
        js: "return { doubled: context.n * 2 };"
  - id: label
    type: agentic
    context_in: { doubled: "{compute.doubled}" }
    instruction: "label the doubled value"
    required_output: Output
`.trim());
  });
  after(() => project.cleanup());

  it("create → start (programmatic auto-runs) pauses at agentic", () => {
    const create = runCli(project.dir, ["wf", "demo", "create", "--param", "n=11"]);
    assert.equal(create.status, 0, create.stderr);
    assert.match(create.stdout, /Instance created/);

    const alias = aliasOf(project.dir, "demo");
    const start = runCli(project.dir, [alias, "start"]);
    assert.equal(start.status, 0, start.stderr);
    assert.match(start.stdout, /Auto-completed: 'compute'/);
    assert.match(start.stdout, /Step 2\/2: label/);
    assert.match(start.stdout, /Required output schema: Output/);
  });

  it("next with valid agent output completes the workflow", () => {
    const alias = aliasOf(project.dir, "demo");
    const next = runCli(project.dir, [
      alias,
      "next",
      "--result",
      JSON.stringify({ label: "twice eleven", doubled: 22 }),
    ]);
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /Workflow 'demo' completed/);

    const status = runCli(project.dir, [alias, "status"]);
    assert.match(status.stdout, /Status:\s+completed/);
    assert.match(status.stdout, /\[x\] 1\. compute/);
    assert.match(status.stdout, /\[x\] 2\. label/);
  });
});

// ── Schema rejection + retry ──

describe("cli e2e — schema rejection", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "strict", `
format: v1
name: strict
schemas:
  Input: { type: object }
  Output:
    type: object
    properties:
      pick: { type: string, enum: [a, b, c] }
    required: [pick]
input: Input
output: Output
steps:
  - id: choose
    type: agentic
    instruction: "pick a, b, or c"
    required_output: Output
`.trim());
  });
  after(() => project.cleanup());

  it("rejects an output that fails the schema and keeps step in_progress", () => {
    runCli(project.dir, ["wf", "strict", "create"]);
    const alias = aliasOf(project.dir, "strict");
    runCli(project.dir, [alias, "start"]);

    const bad = runCli(project.dir, [
      alias,
      "next",
      "--result",
      JSON.stringify({ pick: "z" }),
    ]);
    assert.equal(bad.status, 1, "rejected submission must exit non-zero");
    assert.match(bad.stdout, /SUBMISSION REJECTED/);
    assert.match(bad.stdout, /Schema: Output/);

    // Retry succeeds
    const good = runCli(project.dir, [
      alias,
      "next",
      "--result",
      JSON.stringify({ pick: "a" }),
    ]);
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /completed/);
  });
});

// ── Router (forward + default) ──

describe("cli e2e — router", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "fork", `
format: v1
name: fork
schemas:
  Input:
    type: object
    properties: { mode: { type: string, enum: [fast, slow] } }
    required: [mode]
  Output:
    type: object
    properties: { path: { type: string } }
    required: [path]
input: Input
output: Output
steps:
  - id: r
    type: router
    cases:
      - when: { field: "{{mode}}", op: eq, value: fast }
        goto: fast-path
    default: slow-path
  - id: slow-path
    type: programmatic
    required_output: Output
    actions:
      - { name: slow, description: slow, js: "return { path: 'slow' };" }
  - id: fast-path
    type: programmatic
    required_output: Output
    actions:
      - { name: fast, description: fast, js: "return { path: 'fast' };" }
`.trim());
  });
  after(() => project.cleanup());

  it("routes forward to the chosen branch and skips the other", () => {
    runCli(project.dir, ["wf", "fork", "create", "--param", "mode=fast"]);
    const alias = aliasOf(project.dir, "fork");
    const start = runCli(project.dir, [alias, "start"]);
    assert.equal(start.status, 0, start.stderr);
    assert.match(start.stdout, /Workflow 'fork' completed/);

    const status = runCli(project.dir, [alias, "status"]);
    assert.match(status.stdout, /\[x\] 3\. fast-path/);
    assert.match(status.stdout, /\[ \] 2\. slow-path/);
  });
});

// ── Router backward goto + max_iterations bound ──

describe("cli e2e — router backward goto", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "loop-cap", `
format: v1
name: loop-cap
schemas:
  Input: { type: object }
  Output: { type: object }
  Beat:
    type: object
    properties: { tick: { type: integer } }
    required: [tick]
steps:
  - id: beat
    type: programmatic
    required_output: Beat
    actions:
      - { name: emit, description: emit, js: "return { tick: 1 };" }
  - id: spin
    type: router
    cases: []
    default: beat
    max_iterations: 3
input: Input
output: Output
`.trim());
  });
  after(() => project.cleanup());

  it("errors out cleanly when max_iterations is exceeded", () => {
    runCli(project.dir, ["wf", "loop-cap", "create"]);
    const alias = aliasOf(project.dir, "loop-cap");
    const start = runCli(project.dir, [alias, "start"]);
    assert.equal(start.status, 1);
    assert.match(start.stderr + start.stdout, /max_iterations.*exceeded/);

    const status = runCli(project.dir, [alias, "status"]);
    assert.match(status.stdout, /Status:\s+error/);
  });
});

// ── Call (cross-workflow) ──

describe("cli e2e — call sub-instance", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "double-helper", `
format: v1
name: double-helper
schemas:
  Input:
    type: object
    properties: { n: { type: integer } }
    required: [n]
  Output:
    type: object
    properties: { doubled: { type: integer } }
    required: [doubled]
input: Input
output: Output
steps:
  - id: compute
    type: programmatic
    context_in: { n: "{{n}}" }
    required_output: Output
    actions:
      - { name: double, description: x2, js: "return { doubled: context.n * 2 };" }
`.trim());
    writeWorkflow(project.dir, "uses-helper", `
format: v1
name: uses-helper
schemas:
  Input:
    type: object
    properties: { start: { type: integer } }
    required: [start]
  Output:
    type: object
    properties: { final: { type: integer } }
    required: [final]
input: Input
output: Output
steps:
  - id: call-double
    type: call
    workflow: double-helper
    inputs: { n: "{{start}}" }
  - id: shape
    type: programmatic
    context_in: { d: "{call-double.doubled}" }
    required_output: Output
    actions:
      - { name: shape, description: wrap, js: "return { final: context.d };" }
`.trim());
  });
  after(() => project.cleanup());

  it("runs the child via call and returns its output", () => {
    runCli(project.dir, ["wf", "uses-helper", "create", "--param", "start=21"]);
    const alias = aliasOf(project.dir, "uses-helper");
    const start = runCli(project.dir, [alias, "start"]);
    assert.equal(start.status, 0, start.stderr);
    assert.match(start.stdout, /completed/);

    // The shape step should have read 42 (= 21 * 2 from the called helper)
    // and written it as `final` on the workflow output. Inspect the
    // raw state.yaml so we don't have to depend on query's display shape.
    const dataDir = path.join(project.dir, ".llm-rail", "uses-helper");
    const id = fs.readdirSync(dataDir)[0];
    const state = fs.readFileSync(path.join(dataDir, id, "state.yaml"), "utf-8");
    assert.match(state, /shape:/);
    assert.match(state, /final:\s*42/);
  });
});

// ── Reset cascade ──

describe("cli e2e — reset", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "twostep", `
format: v1
name: twostep
schemas:
  Input: { type: object }
  Output:
    type: object
    properties: { v: { type: integer } }
    required: [v]
input: Input
output: Output
steps:
  - id: a
    type: programmatic
    required_output: Output
    actions:
      - { name: a, description: a, js: "return { v: 1 };" }
  - id: b
    type: programmatic
    required_output: Output
    actions:
      - { name: b, description: b, js: "return { v: 2 };" }
`.trim());
  });
  after(() => project.cleanup());

  it("resets the named step plus everything after it", () => {
    runCli(project.dir, ["wf", "twostep", "create"]);
    const alias = aliasOf(project.dir, "twostep");
    runCli(project.dir, [alias, "start"]);

    let status = runCli(project.dir, [alias, "status"]);
    assert.match(status.stdout, /\[x\] 1\. a/);
    assert.match(status.stdout, /\[x\] 2\. b/);

    const reset = runCli(project.dir, [alias, "reset", "a"]);
    assert.equal(reset.status, 0);
    assert.match(reset.stdout, /Reset: a/);

    status = runCli(project.dir, [alias, "status"]);
    assert.match(status.stdout, /\[ \] 1\. a/);
    assert.match(status.stdout, /\[ \] 2\. b/);
  });
});

// ── Migrate roundtrip ──

describe("cli e2e — migrate", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    fs.writeFileSync(path.join(project.dir, "legacy.yml"), [
      "name: legacy-demo",
      "params:",
      "  url:",
      "    type: string",
      "    required: true",
      "steps:",
      "  - id: fetch",
      "    instruction: \"fetch {{url}}\"",
      "    required_output: [body]",
      "    validation:",
      "      - field: body",
      "        op: type",
      "        value: string",
    ].join("\n"));
  });
  after(() => project.cleanup());

  it("produces a migrated v1 file that compiles", () => {
    const migrate = runCli(project.dir, [
      "wf", "legacy-demo", "migrate",
      "--path", path.join(project.dir, "legacy.yml"),
    ]);
    assert.equal(migrate.status, 0, migrate.stderr);
    const out = path.join(project.dir, "legacy.migrated.yml");
    assert.ok(fs.existsSync(out));

    const compile = runCli(project.dir, [
      "wf", "legacy-demo", "compile", "--path", out,
    ]);
    assert.equal(compile.status, 0, compile.stderr);
    assert.match(compile.stdout, /compiled successfully/);
  });
});

// ── Legacy guard ──

describe("cli e2e — legacy guard", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    fs.writeFileSync(path.join(project.dir, "workflows", "old.yml"), [
      "name: old",
      "steps:",
      "  - id: s",
      "    instruction: do",
      "    required_output: [r]",
    ].join("\n"));
  });
  after(() => project.cleanup());

  it("create on a legacy workflow surfaces the migrate hint", () => {
    const r = runCli(project.dir, ["wf", "old", "create"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /lrail wf .* migrate/);
  });
});

// ── Recursion bound (max_depth) ──

describe("cli e2e — recursion bound", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "infinite", `
format: v1
name: infinite
schemas:
  Input: { type: object }
  Output:
    type: object
    properties: { done: { type: boolean } }
    required: [done]
input: Input
output: Output
max_depth: 3
steps:
  - id: recurse
    type: call
    workflow: infinite
    inputs: {}
  - id: finalize
    type: programmatic
    required_output: Output
    actions:
      - { name: end, description: never reached, js: "return { done: true };" }
`.trim());
  });
  after(() => project.cleanup());

  it("rejects recursion beyond max_depth with a clear error", () => {
    runCli(project.dir, ["wf", "infinite", "create"]);
    const alias = aliasOf(project.dir, "infinite");
    const start = runCli(project.dir, [alias, "start"]);
    assert.equal(start.status, 1);
    assert.match(start.stderr + start.stdout, /max_depth/);
  });
});

// ── Unknown call target ──

describe("cli e2e — unknown call workflow", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "calls-ghost", `
format: v1
name: calls-ghost
schemas:
  Input: { type: object }
  Output: { type: object }
input: Input
output: Output
steps:
  - id: c
    type: call
    workflow: does-not-exist
    inputs: {}
`.trim());
  });
  after(() => project.cleanup());

  it("errors when call references a workflow that doesn't exist", () => {
    runCli(project.dir, ["wf", "calls-ghost", "create"]);
    const alias = aliasOf(project.dir, "calls-ghost");
    const r = runCli(project.dir, [alias, "start"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /unknown workflow 'does-not-exist'/);
  });
});

// ── compile catches problems before run ──

describe("cli e2e — compile static checks", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "bad-router", `
format: v1
name: bad-router
schemas:
  Input: { type: object }
  Output: { type: object }
  R: { type: object, properties: { v: { type: integer } }, required: [v] }
input: Input
output: Output
steps:
  - id: seed
    type: programmatic
    required_output: R
    actions:
      - { name: s, description: seed, js: "return { v: 1 };" }
  - id: spin
    type: router
    cases:
      - when: { field: "{seed.v}", op: gt, value: 100 }
        goto: seed
    default: seed
`.trim());
  });
  after(() => project.cleanup());

  it("compile flags backward goto without max_iterations", () => {
    const r = runCli(project.dir, ["wf", "bad-router", "compile"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /max_iterations/);
  });
});

// ── tool execution ──

describe("cli e2e — tool", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "with-tool", `
format: v1
name: with-tool
schemas:
  Input: { type: object }
  Output:
    type: object
    properties: { greeting: { type: string } }
    required: [greeting]
input: Input
output: Output
tools:
  greet:
    description: Build a greeting
    params:
      who:
        type: string
        required: true
    actions:
      - name: format
        description: format greeting
        js: "return { hello: 'hi ' + context.who };"
steps:
  - id: ask
    type: agentic
    instruction: "ask the user something"
    required_output: Output
`.trim());
  });
  after(() => project.cleanup());

  it("executes a tool action and prints its output as JSON", () => {
    runCli(project.dir, ["wf", "with-tool", "create"]);
    const alias = aliasOf(project.dir, "with-tool");
    runCli(project.dir, [alias, "start"]);

    const r = runCli(project.dir, [
      alias, "tool", "greet", "--args", JSON.stringify({ who: "world" }),
    ]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hello, "hi world");
  });
});

// ── Missing required input ──

describe("cli e2e — missing required input", () => {
  let project: { dir: string; cleanup: () => void };
  before(() => {
    project = makeProject();
    writeWorkflow(project.dir, "needs-input", `
format: v1
name: needs-input
schemas:
  Input:
    type: object
    properties: { x: { type: string } }
    required: [x]
  Output: { type: object }
input: Input
output: Output
steps:
  - id: noop
    type: programmatic
    required_output: Output
    actions:
      - { name: x, description: x, js: "return {};" }
`.trim());
  });
  after(() => project.cleanup());

  it("create errors with a clear message when a required input is missing", () => {
    const r = runCli(project.dir, ["wf", "needs-input", "create"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Missing required input 'x'/);
  });
});
