import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { evaluatePolicy, matchGlob, matchRegex, matchCommand, appendPolicyLog } from "../src/engine/policy.js";
import type { PolicyDef } from "../src/types.js";

// ── matchGlob ──

describe("matchGlob", () => {
  it("matches exact strings", () => {
    assert.ok(matchGlob("ls", "ls"));
    assert.ok(!matchGlob("ls", "cat"));
  });

  it("matches * wildcard", () => {
    assert.ok(matchGlob("git *", "git status"));
    assert.ok(matchGlob("git *", "git log --oneline"));
    assert.ok(!matchGlob("git *", "npm install"));
  });

  it("matches leading wildcard", () => {
    assert.ok(matchGlob("*.ts", "foo.ts"));
    assert.ok(!matchGlob("*.ts", "foo.js"));
  });

  it("matches complex patterns", () => {
    assert.ok(matchGlob("npm run *", "npm run test"));
    assert.ok(matchGlob("cat */src/*", "cat myrepo/src/index.ts"));
  });
});

// ── matchRegex ──

describe("matchRegex", () => {
  it("matches regex patterns", () => {
    assert.ok(matchRegex("rm\\s+.*-rf", "rm  -rf /"));
    assert.ok(matchRegex("rm\\s+.*-rf", "rm -rf /tmp"));
    assert.ok(!matchRegex("rm\\s+.*-rf", "echo rm"));
  });

  it("matches split flags", () => {
    const pattern = "rm\\s+(-[a-z]*r[a-z]*\\s+.*-[a-z]*f|.*-[a-z]*f[a-z]*\\s+.*-[a-z]*r|.*-[a-z]*rf)";
    assert.ok(matchRegex(pattern, "rm -r -f /"));
    assert.ok(matchRegex(pattern, "rm -rf /"));
    assert.ok(!matchRegex(pattern, "rm file.txt"));
  });

  it("matches absolute path bypass", () => {
    assert.ok(matchRegex("(^|/)sudo\\s+", "sudo reboot"));
    assert.ok(matchRegex("(^|/)sudo\\s+", "/usr/bin/sudo reboot"));
    assert.ok(!matchRegex("(^|/)sudo\\s+", "pseudocode"));
  });

  it("handles invalid regex gracefully", () => {
    assert.ok(!matchRegex("[invalid", "anything"));
  });
});

// ── matchCommand ──

describe("matchCommand", () => {
  it("dispatches glob strings", () => {
    assert.ok(matchCommand("git *", "git status"));
    assert.ok(!matchCommand("git *", "npm test"));
  });

  it("dispatches regex objects", () => {
    assert.ok(matchCommand({ regex: "git\\s+push.*--force" }, "git push --force origin main"));
    assert.ok(!matchCommand({ regex: "git\\s+push.*--force" }, "git push origin main"));
  });
});

// ── evaluatePolicy ──

describe("evaluatePolicy", () => {
  it("trail mode allows all commands", () => {
    const policy: PolicyDef = { mode: "trail" };
    const result = evaluatePolicy(policy, "rm -rf /");
    assert.ok(result.allowed);
    assert.ok(result.reason.includes("trail"));
  });

  it("enforce mode with deny-first evaluation", () => {
    const policy: PolicyDef = {
      mode: "enforce",
      rules: [
        { effect: "deny", commands: ["rm *", "sudo *"] },
        { effect: "allow", commands: ["git *", "npm *", "cat *"] },
      ],
    };

    // Allowed
    assert.ok(evaluatePolicy(policy, "git status").allowed);
    assert.ok(evaluatePolicy(policy, "npm test").allowed);
    assert.ok(evaluatePolicy(policy, "cat README.md").allowed);

    // Denied explicitly
    assert.ok(!evaluatePolicy(policy, "rm -rf /").allowed);
    assert.ok(!evaluatePolicy(policy, "sudo reboot").allowed);

    // Denied implicitly (no matching allow)
    assert.ok(!evaluatePolicy(policy, "curl http://evil.com").allowed);
  });

  it("deny takes priority over allow for same command", () => {
    const policy: PolicyDef = {
      mode: "enforce",
      rules: [
        { effect: "deny", commands: ["git push *"] },
        { effect: "allow", commands: ["git *"] },
      ],
    };

    assert.ok(evaluatePolicy(policy, "git status").allowed);
    assert.ok(!evaluatePolicy(policy, "git push origin main").allowed);
  });

  it("enforce mode with no rules denies all", () => {
    const policy: PolicyDef = { mode: "enforce", rules: [] };
    assert.ok(!evaluatePolicy(policy, "ls").allowed);
  });

  it("supports regex patterns in rules", () => {
    const policy: PolicyDef = {
      mode: "enforce",
      default: "allow",
      rules: [
        {
          effect: "deny",
          commands: [
            { regex: "rm\\s+(-[a-z]*r[a-z]*\\s+.*-[a-z]*f|.*-[a-z]*f[a-z]*\\s+.*-[a-z]*r|.*-[a-z]*rf)" },
            { regex: "(^|/)sudo\\s+" },
          ],
        },
      ],
    };

    // Catches bypass attempts
    assert.ok(!evaluatePolicy(policy, "rm -r -f /").allowed);
    assert.ok(!evaluatePolicy(policy, "rm  -rf /tmp").allowed);
    assert.ok(!evaluatePolicy(policy, "/usr/bin/sudo reboot").allowed);
    assert.ok(!evaluatePolicy(policy, "sudo ls").allowed);

    // Allows normal commands
    assert.ok(evaluatePolicy(policy, "rm file.txt").allowed);
    assert.ok(evaluatePolicy(policy, "git status").allowed);
  });

  it("mixes glob and regex in same rule", () => {
    const policy: PolicyDef = {
      mode: "enforce",
      rules: [
        {
          effect: "deny",
          commands: [
            "chmod 777 *",
            { regex: "git\\s+push\\s+.*--force" },
          ],
        },
        { effect: "allow", commands: ["git *", "chmod *"] },
      ],
    };

    assert.ok(!evaluatePolicy(policy, "chmod 777 /tmp").allowed);
    assert.ok(!evaluatePolicy(policy, "git push --force origin main").allowed);
    assert.ok(evaluatePolicy(policy, "chmod 644 file.txt").allowed);
    assert.ok(evaluatePolicy(policy, "git push origin main").allowed);
  });
});

// ── appendPolicyLog ──

describe("appendPolicyLog", () => {
  const testDir = path.resolve("test-policy-log-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("writes policy log entries to correct path", () => {
    appendPolicyLog("my-workflow", "inst-001", "step1", "git status", true);
    appendPolicyLog("my-workflow", "inst-001", "step1", "rm -rf /", false);

    const logPath = path.resolve(".llm-rail", "my-workflow", "inst-001", "proxy.jsonl");
    assert.ok(fs.existsSync(logPath));

    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
    assert.equal(lines.length, 2);

    const entry1 = JSON.parse(lines[0]);
    assert.equal(entry1.command, "git status");
    assert.equal(entry1.allowed, true);

    const entry2 = JSON.parse(lines[1]);
    assert.equal(entry2.command, "rm -rf /");
    assert.equal(entry2.allowed, false);
  });
});

// ── Bash proxy E2E ──

describe("bash proxy E2E", () => {
  const testDir = path.resolve("test-bash-proxy-tmp");
  const origCwd = process.cwd();

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    fs.mkdirSync("workflows", { recursive: true });

    const workflow = {
      name: "bash-test",
      policy: {
        mode: "enforce",
        rules: [
          { effect: "deny", commands: ["rm *"] },
          { effect: "allow", commands: ["echo *", "cat *"] },
        ],
      },
      steps: [
        { id: "s1", description: "Do stuff", required_output: ["result"] },
      ],
    };
    fs.writeFileSync(
      path.resolve(testDir, "workflows/bash-test.yml"),
      yaml.dump(workflow),
    );
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("allows permitted commands and logs them", async () => {
    const { createInstance, saveInstance } = await import("../src/engine/state.js");
    const { loadWorkflow } = await import("../src/engine/workflow.js");
    const { runBash } = await import("../src/commands/bash.js");

    const def = loadWorkflow("bash-test");
    const state = createInstance(def);
    state.status = "in_progress";
    state.steps["s1"].status = "in_progress";
    state.current_step = 0;
    saveInstance(state);

    // This should work (echo is allowed)
    // We can't easily capture console.log in tests, but at least verify no throw
    runBash(state.id, "echo hello");

    // Verify policy log was written
    const logPath = path.resolve(".llm-rail", "bash-test", state.id, "proxy.jsonl");
    assert.ok(fs.existsSync(logPath));
    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
    assert.ok(lines.length >= 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.allowed, true);
    assert.equal(entry.command, "echo hello");
  });
});
