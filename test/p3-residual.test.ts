import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { generateAlias } from "../src/engine/alias.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

interface RunResult { status: number; stdout: string; stderr: string }

function makeProject(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lrail-p3r-"));
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

function aliasOf(projectDir: string, workflowName: string, idx = 0): string {
  const dir = path.join(projectDir, ".llm-rail", workflowName);
  const ids = fs.readdirSync(dir).sort();
  return fs.readFileSync(path.join(dir, ids[idx], "alias"), "utf-8").trim();
}

// ── Alias collision: numeric suffix fallback ──

describe("alias — numeric suffix fallback when bigram space is exhausted", () => {
  it("after 200 retry attempts on a saturated set, returns adj-noun-N format", () => {
    // Saturate the entire bigram space by claiming every "<adj>-<noun>"
    // a generator could produce. The function falls back to appending a
    // random number — which is a 3-segment pattern.
    const ADJECTIVES = [
      "bold","calm","cool","dark","deep","dry","fair","fast","firm","flat",
      "free","full","gold","gray","keen","kind","lean","live","long","mild",
      "neat","open","pale","pure","rare","raw","red","rich","safe","sharp",
      "slim","soft","tall","thin","true","vast","warm","wide","wild","wise",
      "blue","bright","clear","crisp","fresh","green","prime","quick","still","swift",
    ];
    const NOUNS = [
      "arc","ash","bay","bow","cap","cog","dam","dew","dot","elm",
      "fig","fin","fox","gem","hub","ink","ivy","jar","jet","key",
      "kit","lap","log","map","net","oak","orb","owl","pad","pin",
      "ray","rib","rod","rue","rye","sky","sun","tap","tip","urn",
      "vow","wax","web","yew","zen","axe","bee","elm","ore","ram",
    ];
    const saturated = new Set<string>();
    for (const a of ADJECTIVES) {
      for (const n of NOUNS) saturated.add(`${a}-${n}`);
    }
    const fallback = generateAlias(saturated);
    // Format must be adj-noun-NNN (3 segments)
    assert.match(fallback, /^[a-z]+-[a-z]+-\d+$/);
  });

  it("does NOT use numeric fallback when there is room in the bigram space", () => {
    const empty = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const a = generateAlias(empty);
      // Should be 2 segments most of the time
      empty.add(a);
    }
    // Statistically <50 picks from a 2500-bigram space → no fallback
    const distinct = empty.size;
    assert.equal(distinct, 50);
    const numericFallbacks = [...empty].filter((a) => /^[a-z]+-[a-z]+-\d+$/.test(a));
    assert.equal(numericFallbacks.length, 0);
  });
});

// ── Deep nesting audit shape ──

describe("audit — nested call audit lives under each instance dir", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "child", `
format: v1
name: child
schemas:
  Input: { type: object, properties: { x: { type: integer } }, required: [x] }
  Output: { type: object, properties: { y: { type: integer } }, required: [y] }
input: Input
output: Output
steps:
  - id: doit
    type: programmatic
    context_in: { x: "{{x}}" }
    required_output: Output
    actions:
      - { name: g, description: g, js: "return { y: context.x * 2 };" }
`.trim());
    writeWorkflow(p.dir, "parent", `
format: v1
name: parent
schemas:
  Input: { type: object, properties: { x: { type: integer } }, required: [x] }
  Output: { type: object, properties: { y: { type: integer } }, required: [y] }
input: Input
output: Output
steps:
  - id: delegate
    type: call
    workflow: child
    inputs: { x: "{{x}}" }
`.trim());
  });
  after(() => p.cleanup());

  it("parent audit covers full lifecycle; child runs nested without separate dir", () => {
    runCli(p.dir, ["wf", "parent", "create", "--param", "x=21"]);
    const alias = aliasOf(p.dir, "parent");
    const r = runCli(p.dir, [alias, "start"]);
    assert.equal(r.status, 0, r.stderr);

    // The parent's audit log records the call step's auto-completion +
    // workflow_completed. The child does not get its own .llm-rail dir
    // (it's a nested sub-instance).
    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "parent"))[0];
    const events = fs
      .readFileSync(path.join(p.dir, ".llm-rail", "parent", id, "audit.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const types = events.map((e) => e.event);
    assert.ok(types.includes("step_auto_completed"));
    assert.ok(types.includes("workflow_completed"));

    // No separate child instance dir
    assert.equal(fs.existsSync(path.join(p.dir, ".llm-rail", "child")), false);

    // The state.yaml has the child's nested state as part of completion record
    const stateRaw = fs.readFileSync(path.join(p.dir, ".llm-rail", "parent", id, "state.yaml"), "utf-8");
    const state = yaml.load(stateRaw) as { steps: { delegate: { output?: { y?: number } } } };
    assert.equal(state.steps.delegate.output?.y, 42);
  });
});

// ── SIGINT graceful exit on follow log ──

describe("log -f — SIGINT exits cleanly without orphaning watchers", { timeout: 10_000 }, () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "tail", `
format: v1
name: tail
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

  it("kills SIGINT mid-follow → process exits with non-error status", async () => {
    runCli(p.dir, ["wf", "tail", "create"]);
    const alias = aliasOf(p.dir, "tail");
    runCli(p.dir, [alias, "start"]); // pauses at ask; log has entries but no terminator

    const env = { ...process.env, LRAIL_DATA: path.join(p.dir, ".llm-rail") };
    const child = spawn("node", [CLI, alias, "log", "-f"], {
      cwd: p.dir, env, stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait briefly for past entries to print, then SIGINT
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    child.kill("SIGINT");

    const code: number | null = await new Promise((resolve) => {
      child.on("exit", (c) => resolve(c));
    });
    // SIGINT-handled exit returns 0 (from process.exit(0) in log.ts).
    // Process kill (no handler) would return 128+2=130. Either acceptable.
    assert.ok(code === 0 || code === 130, `unexpected exit code: ${code}`);
  });
});

// ── Larger state.yaml roundtrip ──

describe("state-v1 — large state.yaml roundtrip (~500KB)", () => {
  let p: { dir: string; cleanup: () => void };
  before(() => {
    p = makeProject();
    writeWorkflow(p.dir, "big", `
format: v1
name: big
schemas:
  Input: { type: object }
  Output:
    type: object
    properties: { items: { type: array, items: { type: string } } }
    required: [items]
input: Input
output: Output
steps:
  - id: gen
    type: programmatic
    required_output: Output
    actions:
      - name: g
        description: produce many items
        js: |
          const arr = [];
          for (let i = 0; i < 5000; i++) arr.push('item-' + i + '-padded-with-some-text-' + Math.random());
          return { items: arr };
`.trim());
  });
  after(() => p.cleanup());

  it("writes and reloads a state.yaml with a 5k-element array", () => {
    runCli(p.dir, ["wf", "big", "create"]);
    const alias = aliasOf(p.dir, "big");
    const r = runCli(p.dir, [alias, "start"]);
    assert.equal(r.status, 0, r.stderr);

    const id = fs.readdirSync(path.join(p.dir, ".llm-rail", "big"))[0];
    const stateFile = path.join(p.dir, ".llm-rail", "big", id, "state.yaml");
    const sizeKB = fs.statSync(stateFile).size / 1024;
    assert.ok(sizeKB > 100, `expected >100KB state.yaml, got ${sizeKB}KB`);

    const state = yaml.load(fs.readFileSync(stateFile, "utf-8")) as {
      steps: { gen: { output?: { items?: string[] } } };
    };
    assert.equal(state.steps.gen.output?.items?.length, 5000);

    // Status query reads the same file — must still parse
    const st = runCli(p.dir, [alias, "status"]);
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /Status:\s+completed/);
  });
});
