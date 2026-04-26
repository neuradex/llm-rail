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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-p9-"));
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

// ── Top-level CLI: banner / help / version / unknown ──

describe("CLI top-level", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => { p = makeProject(); });
  after(() => p.cleanup());

  it("no args prints banner and exits 0", () => {
    const r = runCli(p.dir, []);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /LLM Rail/);
    assert.match(r.stdout, /Run 'lrail docs' to get started/);
  });

  it("--version prints package.json version", () => {
    const r = runCli(p.dir, ["--version"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\d+\.\d+\.\d+/);
  });

  it("-v prints version", () => {
    const r = runCli(p.dir, ["-v"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\d+\.\d+\.\d+/);
  });

  it("version subcommand prints version", () => {
    const r = runCli(p.dir, ["version"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\d+\.\d+\.\d+/);
  });

  it("--help prints usage to stderr", () => {
    const r = runCli(p.dir, ["--help"]);
    assert.equal(r.status, 1); // usage() calls process.exit(1)
    assert.match(r.stderr, /Usage:/);
  });

  it("-h prints usage", () => {
    const r = runCli(p.dir, ["-h"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Usage:/);
  });

  it("unknown top-level target errors with hint", () => {
    const r = runCli(p.dir, ["totally-unknown-target"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unknown command or instance/);
  });
});

// ── docs ──

describe("CLI docs", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => { p = makeProject(); });
  after(() => p.cleanup());

  it("no topic lists available topics", () => {
    const r = runCli(p.dir, ["docs"]);
    assert.equal(r.status, 0, r.stderr);
    // Topic index should mention some known topics from learn/
    assert.ok(/concepts|workflow/i.test(r.stdout), r.stdout);
  });

  it("a known topic prints content", () => {
    const r = runCli(p.dir, ["docs", "concepts"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.length > 50);
  });

  it("an unknown topic exits with an error", () => {
    const r = runCli(p.dir, ["docs", "no-such-topic-zzz"]);
    assert.notEqual(r.status, 0);
  });
});

// ── init ──

describe("CLI init", () => {
  it("on a fresh project: creates lrail.yml + workflows/ + .gitignore", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-init-fresh-"));
    try {
      const r = runCli(dir, ["init"]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(dir, "lrail.yml")));
      assert.ok(fs.existsSync(path.join(dir, "workflows")));
      const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
      assert.match(gi, /\.llm-rail\//);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips lrail.yml + workflows/ when they already exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-init-skip-"));
    try {
      fs.writeFileSync(path.join(dir, "lrail.yml"), "preexisting: yes");
      fs.mkdirSync(path.join(dir, "workflows"));
      fs.writeFileSync(path.join(dir, ".gitignore"), ".llm-rail/\nnode_modules/\n");
      const r = runCli(dir, ["init"]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /lrail\.yml already exists/);
      assert.match(r.stdout, /workflows\/ already exists/);
      // lrail.yml not overwritten
      assert.equal(fs.readFileSync(path.join(dir, "lrail.yml"), "utf-8"), "preexisting: yes");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends .llm-rail/ to existing .gitignore that lacks it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-init-gi-"));
    try {
      fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
      runCli(dir, ["init"]);
      const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
      assert.match(gi, /node_modules\//);
      assert.match(gi, /\.llm-rail\//);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── show ──

describe("CLI show", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "showme", `
format: v1
name: showme
description: a description
phase: dev
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

  it("emits the workflow YAML", () => {
    const r = runCli(p.dir, ["wf", "showme", "show"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /name: showme/);
    assert.match(r.stdout, /Phase: dev/);
    assert.match(r.stdout, /Steps: 1/);
  });
});

// ── promote ──

describe("CLI promote", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "prom", `
format: v1
name: prom
phase: draft
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

  it("with no completed instances → 'Run the workflow first'", () => {
    const r = runCli(p.dir, ["wf", "prom", "promote"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /No completed instances|Run the workflow first/);
  });

  it("draft + 2 completed runs → recommends promote to dev", () => {
    runCli(p.dir, ["wf", "prom", "create"]);
    runCli(p.dir, [aliasOf(p.dir, "prom"), "start"]);
    runCli(p.dir, ["wf", "prom", "create"]);
    const ids = fs.readdirSync(path.join(p.dir, ".llm-rail", "prom")).sort();
    const second = fs.readFileSync(path.join(p.dir, ".llm-rail", "prom", ids[ids.length - 1], "alias"), "utf-8").trim();
    runCli(p.dir, [second, "start"]);

    const r = runCli(p.dir, ["wf", "prom", "promote"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Promote to 'dev'/);
  });

  it("dev + no agentic steps → recommends promote to stable", () => {
    writeWorkflow(p.dir, "stab", `
format: v1
name: stab
phase: dev
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
    runCli(p.dir, ["wf", "stab", "create"]);
    runCli(p.dir, [aliasOf(p.dir, "stab"), "start"]);
    const r = runCli(p.dir, ["wf", "stab", "promote"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Promote to 'stable'|Ready to promote to 'stable'/);
  });

  it("phase=stable → 'Already stable'", () => {
    writeWorkflow(p.dir, "fin", `
format: v1
name: fin
phase: stable
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
    runCli(p.dir, ["wf", "fin", "create"]);
    runCli(p.dir, [aliasOf(p.dir, "fin"), "start"]);
    const r = runCli(p.dir, ["wf", "fin", "promote"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Already stable/);
  });
});

// ── variants ──

describe("CLI variants", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "varbase", `
format: v1
name: varbase
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

  it("lists 'no variants' for fresh workflow dir", () => {
    const r = runCli(p.dir, ["wf", "varbase", "variants"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No variants found/);
  });

  it("save-variant --yaml writes <name>.workflow.yml file", () => {
    const variantYaml = `
extends: base
variant: fast
phase: dev
`.trim();
    const r = runCli(p.dir, ["wf", "varbase", "save-variant", "fast", "--yaml", variantYaml]);
    assert.equal(r.status, 0, r.stderr);
    const variantPath = path.join(p.dir, "workflows", "varbase", "fast.workflow.yml");
    assert.ok(fs.existsSync(variantPath));
    const list = runCli(p.dir, ["wf", "varbase", "variants"]);
    assert.match(list.stdout, /fast/);
  });

  it("save-variant on a single-file workflow → error", () => {
    fs.writeFileSync(path.join(p.dir, "workflows", "single.yml"), `format: v1
name: single
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
steps: [{ id: x, type: programmatic, required_output: Output, actions: [{ name: x, description: x, js: "return {};" }] }]
`);
    const r = runCli(p.dir, ["wf", "single", "save-variant", "v1", "--yaml", "extends: base\nvariant: v1"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /must be in directory format/);
  });

  it("merge command rejects with v1-not-supported message", () => {
    const r = runCli(p.dir, ["wf", "varbase", "merge", "fast"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not yet supported in v1/);
  });
});

// ── policy CLI subcommands ──

describe("CLI policy subcommands", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "pol", `
format: v1
name: pol
schemas: { Input: { type: object }, Output: { type: object } }
input: Input
output: Output
policy:
  mode: enforce
  default: deny
  rules:
    - effect: allow
      commands: ["echo *"]
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("policy check on workflow: allowed command", () => {
    const r = runCli(p.dir, ["wf", "pol", "policy", "check", "--command", "echo hi"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ALLOWED/);
  });

  it("policy check on workflow: denied command", () => {
    const r = runCli(p.dir, ["wf", "pol", "policy", "check", "--command", "rm -rf /tmp/foo"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /DENIED/);
  });

  it("policy generate from proxy.jsonl produces an allow-list YAML", () => {
    runCli(p.dir, ["wf", "pol", "create"]);
    const alias = aliasOf(p.dir, "pol");
    runCli(p.dir, [alias, "start"]);
    runCli(p.dir, [alias, "bash", "echo one"]);
    runCli(p.dir, [alias, "bash", "echo two"]);

    const r = runCli(p.dir, [alias, "policy", "generate"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /allow-list/);
    assert.match(r.stdout, /effect: allow/);
    assert.match(r.stdout, /"echo \*"/);
  });

  it("policy eval against project lrail.yml — exit 0 allow / 1 deny", () => {
    fs.writeFileSync(path.join(p.dir, "lrail.yml"), `
policy:
  mode: enforce
  default: deny
  rules:
    - effect: allow
      commands: ["echo *"]
`.trim());
    const ok = runCli(p.dir, ["policy", "eval", "--command", "echo hello"]);
    assert.equal(ok.status, 0);
    const denied = runCli(p.dir, ["policy", "eval", "--command", "rm /tmp/x"]);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /DENIED/);
  });

  it("policy visible: exit 0 if visible:true, exit 1 otherwise", () => {
    fs.writeFileSync(path.join(p.dir, "lrail.yml"), "visible: true\n");
    const r1 = runCli(p.dir, ["policy", "visible"]);
    assert.equal(r1.status, 0);

    fs.writeFileSync(path.join(p.dir, "lrail.yml"), "visible: false\n");
    const r2 = runCli(p.dir, ["policy", "visible"]);
    assert.equal(r2.status, 1);

    fs.writeFileSync(path.join(p.dir, "lrail.yml"), "policy: { mode: trail }\n");
    const r3 = runCli(p.dir, ["policy", "visible"]);
    assert.equal(r3.status, 1);
  });
});

// ── summary --variant rejection (already covered by P1, but pin variant rejection on summary too) ──

describe("CLI summary --variant rejection", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "sm", `
format: v1
name: sm
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

  it("summary --variant errors", () => {
    const r = runCli(p.dir, ["wf", "sm", "summary", "--variant", "xyz"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /v1 workflows do not yet support variants/);
  });
});
