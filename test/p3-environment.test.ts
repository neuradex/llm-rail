import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

interface RunResult { status: number; stdout: string; stderr: string }

function makeProject(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-p3-"));
  fs.mkdirSync(path.join(dir, "workflows"), { recursive: true });
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeWorkflow(projectDir: string, name: string, body: string): void {
  const dir = path.join(projectDir, "workflows", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workflow.yml"), body);
}

function runCli(projectDir: string, args: string[], timeout = 30_000): RunResult {
  const env = { ...process.env, LRAIL_DATA: path.join(projectDir, ".llm-rail") };
  const res: SpawnSyncReturns<string> = spawnSync("node", [CLI, ...args], {
    cwd: projectDir, env, encoding: "utf-8", timeout,
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function aliasOf(projectDir: string, workflowName: string, idx = 0): string {
  const dir = path.join(projectDir, ".llm-rail", workflowName);
  const ids = fs.readdirSync(dir).sort();
  return fs.readFileSync(path.join(dir, ids[idx], "alias"), "utf-8").trim();
}

// ── CONTEXT vs CONTEXT_FILE threshold ──

describe("p3 — shell action large context (CONTEXT_FILE switch at 8KB)", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "bigctx", `
format: v1
name: bigctx
schemas:
  Input: { type: object }
  Output:
    type: object
    properties:
      env_kind: { type: string }
      data_len: { type: integer }
    required: [env_kind, data_len]
  Big:
    type: object
    properties:
      payload: { type: string }
    required: [payload]
input: Input
output: Output
steps:
  - id: build
    type: programmatic
    required_output: Big
    actions:
      - name: gen
        description: generate ~16KB string
        js: "return { payload: 'a'.repeat(16384) };"
  - id: read
    type: programmatic
    context_in:
      payload: "{build.payload}"
    required_output: Output
    actions:
      - name: peek
        description: shell reports which env path was used
        shell: |
          if [ -n "$CONTEXT_FILE" ]; then
            kind=file
            len=$(wc -c < "$CONTEXT_FILE" | tr -d ' ')
          else
            kind=env
            len=\${#CONTEXT}
          fi
          echo "{\\"env_kind\\":\\"$kind\\",\\"data_len\\":$len}"
        extract: { env_kind: env_kind, data_len: data_len }
`.trim());
  });
  after(() => p.cleanup());

  it("uses CONTEXT_FILE for payloads larger than 8KB", () => {
    runCli(p.dir, ["wf", "bigctx", "create"]);
    const alias = aliasOf(p.dir, "bigctx");
    const r = runCli(p.dir, [alias, "start"]);
    assert.equal(r.status, 0, r.stderr);
    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "bigctx"))[0];
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "bigctx", id, "state.yaml"), "utf-8");
    const state = yaml.load(stateRaw) as { steps: Record<string, { output?: { env_kind?: string; data_len?: number } }> };
    assert.equal(state.steps.read.output?.env_kind, "file");
    // The file holds the full context JSON, so len should be > 16KB
    assert.ok((state.steps.read.output?.data_len ?? 0) > 16000);
  });
});

describe("p3 — shell action small context (env CONTEXT path)", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "smctx", `
format: v1
name: smctx
schemas:
  Input: { type: object }
  Output: { type: object, properties: { kind: { type: string } }, required: [kind] }
input: Input
output: Output
steps:
  - id: peek
    type: programmatic
    required_output: Output
    actions:
      - name: peek
        description: shell reports env path used
        shell: |
          if [ -n "$CONTEXT_FILE" ]; then
            echo '{"kind":"file"}'
          else
            echo '{"kind":"env"}'
          fi
        extract: { kind: kind }
`.trim());
  });
  after(() => p.cleanup());

  it("uses CONTEXT env for small payloads (< 8KB)", () => {
    runCli(p.dir, ["wf", "smctx", "create"]);
    const alias = aliasOf(p.dir, "smctx");
    const r = runCli(p.dir, [alias, "start"]);
    assert.equal(r.status, 0, r.stderr);
    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "smctx"))[0];
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "smctx", id, "state.yaml"), "utf-8");
    const state = yaml.load(stateRaw) as { steps: Record<string, { output?: { kind?: string } }> };
    assert.equal(state.steps.peek.output?.kind, "env");
  });
});

// ── YAML special characters in output ──

describe("p3 — YAML serialization of special characters in output", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "yamlspec", `
format: v1
name: yamlspec
schemas:
  Input: { type: object }
  Output:
    type: object
    properties:
      multiline: { type: string }
      colony: { type: string }
      starred: { type: string }
      ampersand: { type: string }
      unicode: { type: string }
      bignum: { type: integer }
      neg: { type: integer }
    required: [multiline, colony, starred, ampersand, unicode, bignum, neg]
input: Input
output: Output
steps:
  - id: gen
    type: programmatic
    required_output: Output
    actions:
      - name: g
        description: produce tricky values
        js: |
          return {
            multiline: 'line1\\nline2\\nline3',
            colony: 'key: value',
            starred: '*foo',
            ampersand: '&bar',
            unicode: '한글 🚀 mixed',
            bignum: 9007199254740991,
            neg: -1234,
          };
`.trim());
  });
  after(() => p.cleanup());

  it("roundtrips multi-line strings, colons, asterisks, ampersands, unicode, big/neg ints", () => {
    runCli(p.dir, ["wf", "yamlspec", "create"]);
    const alias = aliasOf(p.dir, "yamlspec");
    const r = runCli(p.dir, [alias, "start"]);
    assert.equal(r.status, 0, r.stderr);
    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "yamlspec"))[0];
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "yamlspec", id, "state.yaml"), "utf-8");
    const state = yaml.load(stateRaw) as { steps: { gen: { output: Record<string, unknown> } } };
    const out = state.steps.gen.output;
    assert.equal(out.multiline, "line1\nline2\nline3");
    assert.equal(out.colony, "key: value");
    assert.equal(out.starred, "*foo");
    assert.equal(out.ampersand, "&bar");
    assert.equal(out.unicode, "한글 🚀 mixed");
    assert.equal(out.bignum, 9007199254740991);
    assert.equal(out.neg, -1234);
  });
});

// ── Multi-instance: distinct aliases + isolated state ──

describe("p3 — multi-instance same workflow", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "multi", `
format: v1
name: multi
schemas:
  Input:
    type: object
    properties: { tag: { type: string } }
    required: [tag]
  Output:
    type: object
    properties: { echoed: { type: string } }
    required: [echoed]
input: Input
output: Output
steps:
  - id: echo
    type: programmatic
    context_in: { tag: "{{tag}}" }
    required_output: Output
    actions:
      - name: e
        description: echo
        js: "return { echoed: context.tag };"
`.trim());
  });
  after(() => p.cleanup());

  it("creates two instances with distinct aliases and runs them independently", () => {
    runCli(p.dir, ["wf", "multi", "create", "--param", "tag=alpha"]);
    runCli(p.dir, ["wf", "multi", "create", "--param", "tag=beta"]);
    runCli(p.dir, ["wf", "multi", "create", "--param", "tag=gamma"]);

    const ids = fs.readdirSync(path.join(p.dir, ".llm-rail", "multi"));
    assert.equal(ids.length, 3, `expected 3 instance dirs, got ${ids.length}`);

    const aliases = new Set<string>();
    for (const id of ids) {
      const a = fs.readFileSync(path.join(p.dir, ".llm-rail", "multi", id, "alias"), "utf-8").trim();
      assert.match(a, /^[a-z]+-[a-z]+/);
      aliases.add(a);
    }
    assert.equal(aliases.size, 3, "aliases should be globally unique");

    // Run each — verify each writes its own tag
    const tagsByAlias = new Map<string, string>();
    for (const a of aliases) {
      const r = runCli(p.dir, [a, "start"]);
      assert.equal(r.status, 0, `start ${a}: ${r.stderr}`);
      // Locate the id this alias maps to
      const id = ids.find((x) =>
        fs.readFileSync(path.join(p.dir, ".llm-rail", "multi", x, "alias"), "utf-8").trim() === a,
      )!;
      const state = yaml.load(
        fs.readFileSync(path.join(p.dir, ".llm-rail", "multi", id, "state.yaml"), "utf-8"),
      ) as { steps: { echo: { output?: { echoed?: string } } } };
      tagsByAlias.set(a, state.steps.echo.output?.echoed ?? "");
    }
    const distinctTags = new Set(tagsByAlias.values());
    assert.deepEqual([...distinctTags].sort(), ["alpha", "beta", "gamma"]);
  });
});

// ── Loom graph JSON shape stability ──

describe("p3 — graph JSON shape (Loom contract)", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "complex", `
format: v1
name: complex
description: covers all step types
schemas:
  Input:
    type: object
    properties: { mode: { type: string }, n: { type: integer } }
    required: [mode, n]
  Output:
    type: object
    properties: { final: { type: string } }
    required: [final]
  Mid:
    type: object
    properties:
      stats:
        type: object
        properties: { count: { type: integer } }
        required: [count]
    required: [stats]
input: Input
output: Output
steps:
  - id: gather
    type: programmatic
    context_in:
      m: "{{mode}}"
      depth: "{{n}}"
    required_output: Mid
    actions:
      - name: g
        description: gather
        js: "return { stats: { count: 1 } };"
  - id: pick
    type: router
    context_in:
      c: "{gather.stats.count}"
    cases:
      - when: { field: "{{mode}}", op: eq, value: "fast" }
        goto: tail
    default: ask
  - id: ask
    type: agentic
    instruction: produce final
    required_output: Output
    context_in:
      hint: "{gather.stats.count}"
  - id: tail
    type: programmatic
    required_output: Output
    actions:
      - name: t
        description: t
        js: "return { final: 'tail' };"
`.trim());
  });
  after(() => p.cleanup());

  it("emits stable top-level shape with required arrays", () => {
    const r = runCli(p.dir, ["wf", "complex", "graph", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const g = JSON.parse(r.stdout);

    // Top-level keys
    for (const k of ["format", "name", "schemas", "input", "output", "nodes", "control_edges", "data_edges", "input_refs"]) {
      assert.ok(k in g, `missing top-level key: ${k}`);
    }
    assert.equal(g.format, "v1");

    // Nodes carry id+type for every step
    const ids = g.nodes.map((n: { id: string }) => n.id).sort();
    assert.deepEqual(ids, ["ask", "gather", "pick", "tail"]);

    // control_edges include router-case + router-default + sequential
    const kinds = new Set(g.control_edges.map((e: { kind: string }) => e.kind));
    assert.ok(kinds.has("router-case"));
    assert.ok(kinds.has("router-default"));
    assert.ok(kinds.has("sequential"));

    // data_edges include dotted from_path
    const dottedEdge = g.data_edges.find((e: { from_path: string }) => e.from_path === "stats.count");
    assert.ok(dottedEdge, "expected a data_edge with from_path 'stats.count'");

    // input_refs separated from data_edges. By design only context_in
    // and call.inputs are surfaced — router.when.field references are
    // control flow, not data flow, so {{mode}} inside the router does
    // NOT show up here, only the gather step's two refs.
    const refs = g.input_refs.map((r: { path: string }) => r.path).sort();
    assert.deepEqual(refs, ["mode", "n"]);
  });
});

// ── start guard already-error state ──

describe("p3 — start on errored instance", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "fail", `
format: v1
name: fail
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
    actions:
      - name: x
        description: x
        js: "return { v: 'not-an-int' };"
`.trim());
  });
  after(() => p.cleanup());

  it("start on error state is rejected", () => {
    runCli(p.dir, ["wf", "fail", "create"]);
    const alias = aliasOf(p.dir, "fail");
    const r1 = runCli(p.dir, [alias, "start"]);
    assert.equal(r1.status, 1, "first start should fail (schema violation)");

    const r2 = runCli(p.dir, [alias, "start"]);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /error state/);
  });

  it("reset recovers an errored instance to in_progress", () => {
    runCli(p.dir, ["wf", "fail", "create"]);
    const ids = fs.readdirSync(path.join(p.dir, ".llm-rail", "fail")).sort();
    const id = ids[ids.length - 1];
    const alias = fs.readFileSync(path.join(p.dir, ".llm-rail", "fail", id, "alias"), "utf-8").trim();
    runCli(p.dir, [alias, "start"]); // produces error
    const r = runCli(p.dir, [alias, "reset", "bad"]);
    assert.equal(r.status, 0);
    const st = runCli(p.dir, [alias, "status"]).stdout;
    assert.match(st, /Status:\s+in_progress/);
  });
});

// ── Action timeout enforcement ──

describe("p3 — programmatic action timeout_ms", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "tmo", `
format: v1
name: tmo
schemas:
  Input: { type: object }
  Output: { type: object }
input: Input
output: Output
steps:
  - id: slow
    type: programmatic
    timeout_ms: 200
    required_output: Output
    actions:
      - name: sleep
        description: shell sleeps past timeout
        shell: "sleep 5"
`.trim());
  });
  after(() => p.cleanup());

  it("kills a shell action that exceeds timeout_ms", { timeout: 10_000 }, () => {
    runCli(p.dir, ["wf", "tmo", "create"]);
    const alias = aliasOf(p.dir, "tmo");
    const r = runCli(p.dir, [alias, "start"]);
    assert.equal(r.status, 1);
    // Step is in error state
    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "tmo"))[0];
    const state = yaml.load(
      fs.readFileSync(path.join(p.dir, ".llm-rail", "tmo", id, "state.yaml"), "utf-8"),
    ) as { status: string; steps: { slow: { status: string } } };
    assert.equal(state.status, "error");
  });
});

// ── Workflow with no policy: bash flows through ──

describe("p3 — bash without workflow policy", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "bash-ok", `
format: v1
name: bash-ok
schemas:
  Input: { type: object }
  Output: { type: object }
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

  it("instance bash succeeds when no policy is declared", () => {
    runCli(p.dir, ["wf", "bash-ok", "create"]);
    const alias = aliasOf(p.dir, "bash-ok");
    runCli(p.dir, [alias, "start"]);
    const r = runCli(p.dir, [alias, "bash", "echo hello-world"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /hello-world/);
  });
});

// ── Workflow with enforce policy denies and logs ──

describe("p3 — bash with workflow enforce policy", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "bash-locked", `
format: v1
name: bash-locked
schemas:
  Input: { type: object }
  Output: { type: object }
input: Input
output: Output
policy:
  mode: enforce
  default: deny
  rules:
    - effect: allow
      commands:
        - "echo *"
steps:
  - id: ask
    type: agentic
    instruction: ask
    required_output: Output
`.trim());
  });
  after(() => p.cleanup());

  it("allows whitelisted echo, denies arbitrary command", () => {
    runCli(p.dir, ["wf", "bash-locked", "create"]);
    const alias = aliasOf(p.dir, "bash-locked");
    runCli(p.dir, [alias, "start"]);

    const ok = runCli(p.dir, [alias, "bash", "echo allowed"]);
    assert.equal(ok.status, 0, ok.stderr);

    const denied = runCli(p.dir, [alias, "bash", "ls /tmp"]);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Policy denied/);
  });
});
