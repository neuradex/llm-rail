<!-- AGENT NOTE: If you modify this file, also update docs/README.ko.md (Korean) and docs/README.ja.md (Japanese) to keep translations in sync. -->

<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<h1 align="center">LLM Rail</h1>

<p align="center">
  <strong>Guardrails for AI agents that actually work.</strong>
  <br>
  Structural safety. Workflow control. Full audit.
</p>

<p align="center">
  <a href="#install-and-forget">Install & Forget</a> ·
  <a href="#how-it-protects-you">How It Protects You</a> ·
  <a href="#workflow-engine">Workflow Engine</a> ·
  <a href="#security-architecture">Security Architecture</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="./docs/README.ko.md">한국어</a> ·
  <a href="./docs/README.ja.md">日本語</a>
</p>

> **Beta (0.x.x)** — Under active development. APIs and schema may change. Pin your version if you depend on stability.

---

Your AI agent just ran `rm -rf` on your project. Or leaked your API key in its output. Or force-pushed to main.

You told it to be careful. It ignored you — because that's what LLMs do when context grows long enough. Prompt-level safety is a suggestion. Agents don't follow suggestions.

**LLM Rail enforces safety structurally.** Not through prompts, but through hooks that intercept every command before it runs, policies that block what shouldn't execute, and audit logs that record everything that does.

It works at two levels:

- **Instant protection** — install the plugin, and every Claude Code session is guarded. Dangerous commands are blocked. Secrets are redacted. Everything is logged.
- **Workflow control** — for complex tasks, decompose work into validated steps where each step gets only the context it needs, runs under its own policy, and must pass validation before advancing.

Both levels share the same policy engine, the same audit infrastructure, and the same security model. The guardrails you configure for everyday use also protect your workflows.

```bash
# That's the whole setup.
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

---

## Install and Forget

On your next Claude Code session, `lrail.yml` is auto-created with sensible defaults. That one file does everything:

```yaml
# lrail.yml — auto-generated, edit anytime
visible: false          # agents can't see or modify this file

policy:
  mode: enforce
  default: allow        # deny-list approach: block specific commands
  rules:
    - effect: deny
      commands:
        - "rm -rf *"                             # recursive force delete
        - regex: "rm\\s+-r\\s"                   # rm -r (recursive delete)
        - "sudo *"                               # privilege escalation
        - "git push --force *"                   # force push
        - regex: "git\\s+reset\\s+--hard"        # hard reset
        - regex: "git\\s+clean\\s+(-\\w*f)"      # git clean (deletes untracked files)
        - regex: "git\\s+checkout\\s+--\\s+\\."   # git checkout -- . (mass revert)
        - regex: "curl.*\\|\\s*(bash|sh)"        # pipe to shell
        - regex: "npm\\s+(uninstall|remove)\\s+.*llm-rail"  # self-protection
        - regex: "lrail\\.yml"                   # protect this config
```

Put it in your home directory and it covers every project underneath. Put it in a specific project and it overrides the global one for that directory tree. The nearest `lrail.yml` walking up from cwd wins — just like `.gitignore`.

**One file. Zero setup. Every session guarded.**

---

## How It Protects You

### Policy: controlling what agents can do

Every Bash command the agent runs is intercepted by a PreToolUse hook and checked against your policy rules before it executes. Denied commands never run.

Simple rules use glob patterns. When you need precision — catching flag reordering, absolute path tricks, or subcommand variants — use regex:

```yaml
rules:
  - effect: deny
    commands:
      - "sudo *"                                    # glob — blocks sudo
      - regex: "rm\\s+(-\\w*r\\w*\\s+)*-\\w*f"     # regex — catches rm -rf, rm -r -f, rm -fr, etc.
      - regex: "git\\s+push\\s+.*(--force|\\s-f)"   # regex — catches all force-push variants
```

An agent that knows `rm -rf` is blocked might try `rm -r -f` or `/bin/rm -rf`. Glob patterns miss these. Regex doesn't.

### Secrets: use them without seeing them

Agents need API keys to call external services. But they shouldn't see the actual values, and they definitely shouldn't print them in their output.

```yaml
env:
  secret_files: [.env, .env.local]
```

This one line does three things:

1. **Injects** — secret values from your `.env` files are injected into the agent's subprocess environment
2. **Redacts** — any output containing a secret value is replaced with `[REDACTED]` before the agent sees it
3. **Blocks** — Read and Grep hooks prevent agents from accessing the `.env` files directly

The agent writes `curl -H "Authorization: Bearer $API_KEY" ...` and it works. But it never learns what `$API_KEY` actually is.

### Audit: everything is recorded

Every command from every source — hooks, proxies, CLI — goes into a single command log with timestamps, source tags, and policy decisions:

```bash
lrail log              # recent commands
lrail log -n 50        # last 50
lrail log -f           # follow in real-time
lrail log --raw        # machine-readable TSV
```

Denied commands are logged too. You can see exactly what the agent tried to do and what was blocked.

### Self-protection: agents can't change the rules

`visible: false` (the default) means agents can't read `lrail.yml` through any tool — Read, Edit, Write, Grep, or Bash. They don't know what rules exist, so they can't game them.

If you want agents to see the rules and adapt their behavior ("this will be denied, let me try another approach"), set `visible: true`. This is a deliberate choice, not a default.

---

## Workflow Engine

Guardrails protect against bad actions. But complex tasks fail for a different reason: LLMs have **recency bias**. The longer the context, the more they forget their original instructions. In a 200-step task, an agent will inevitably skip steps, fabricate data, or drift from the plan.

The workflow engine solves this by decomposing work into steps where **each step gets a clean, narrow context** with only the data it needs. A step that receives 10K tokens of focused input produces better output than an agent drowning in 100K tokens of accumulated history.

This has a direct cost implication: when context is narrow enough, **Haiku produces the same quality as Opus** at a fraction of the cost. The model doesn't need to be smart — it needs to be focused. LLM Rail makes focus structural.

```yaml
name: code-review
steps:
  - id: fetch-diff
    type: programmatic
    actions:
      - shell: "git diff {{base_branch}}...HEAD"
        extract: { diff: "." }

  - id: review
    description: "Review the diff for issues"
    depends_on: fetch-diff
    context_in:
      diff: "{fetch-diff.diff}"
    required_output: [issues, severity]
    validation:
      - field: issues
        op: type
        value: array
      - field: severity
        op: one_of
        value: [low, medium, high, critical]
```

`fetch-diff` runs as a shell command — no LLM, no tokens, milliseconds. `review` gets exactly the diff it needs via `context_in`, produces exactly the output declared in `required_output`, and the output must pass `validation` before the workflow advances.

### Two step types, one workflow

| | Programmatic | Agentic |
|---|---|---|
| Execution | CLI runs it directly | LLM agent does the work |
| Cost | Zero tokens | Minimal (scoped context) |
| Speed | Milliseconds | Seconds |
| Use when | Deterministic ops (fetch, filter, post) | Judgment needed (analyze, review, write) |

The power is in mixing them. Fetch data programmatically, analyze with an agent, post results programmatically. The deterministic parts never hallucinate because no LLM is involved.

### Validation gates

Each step's output passes through two tiers of checks:

- **validation** — runs before the step completes. Rejects bad output immediately. The agent gets the error message and retries.
- **assertions** — runs after the step completes (including any post-step actions). Reverts the step on failure. The agent retries automatically.

```yaml
validation:
  - field: score
    op: between
    value: [0, 100]
  - field: sources
    op: each_has
    value: url
    message: "Every source must have a URL"
assertions:
  - field: sources
    op: verify_source          # fetches URLs, verifies data actually exists
    value: { field: "snippet", sample_size: 3 }
```

22 built-in operators cover type checks, ranges, array validation, uniqueness, and anti-fabrication (`verify_source` fetches URLs and confirms the cited data actually exists on the page). For anything custom, `script` runs a shell command as a validation gate.

### Policy per workflow

The project-level policy in `lrail.yml` protects everything globally. Workflows can layer additional restrictions on top:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl -s https://api.example.com/*", "jq *"]
    - effect: deny
      commands: ["curl *", "rm *"]
```

A code-review workflow might allow `git diff` and `jq`. A data-collection workflow might allow specific API endpoints. Each workflow gets exactly the permissions it needs — nothing more.

### Lifecycle and variants

Workflows mature through phases: `draft` → `dev` → `stable`. In draft, you experiment freely. In dev, you tighten validation and convert agentic steps to programmatic where possible. In stable, policy must be in enforce mode.

Multiple design approaches can coexist as variants — different step structures, different models, different data sources — and the winner gets merged into the base:

```bash
lrail wf code-review variants           # list variants
lrail wf code-review merge api-driven   # merge winning variant
lrail wf code-review promote            # check if ready for next phase
```

### Complete audit trail

Every workflow instance records its full history:

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # current instance state
  ├── audit.jsonl      # all lifecycle events (step starts, completions, rejections, resets)
  └── proxy.jsonl     # all command executions with policy decisions
```

Combined with the global `lrail log`, you get a complete picture: what the agent did, what was allowed, what was blocked, and why.

---

## Security Architecture

All of LLM Rail's protections — policy, secrets, audit, self-protection — converge into a single architecture that covers both standalone use and workflow execution:

```
┌─ Project Policy (lrail.yml) ─────────────────────────────┐
│                                                           │
│  Main Agent (hook)              Subagent (proxy)          │
│  ┌──────────────────┐          ┌──────────────────┐      │
│  │ PreToolUse hook   │          │ lrail <id> bash   │      │
│  │ → policy eval     │          │ → project policy  │      │
│  │ → secret redact   │          │ → workflow policy │      │
│  │ → command log     │          │ → secret redact   │      │
│  └──────────────────┘          │ → command log     │      │
│                                 └──────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

| Layer | What it enforces | How |
|---|---|---|
| **Bash hook** | Which commands can run | PreToolUse intercepts every Bash call, evaluates policy, blocks with exit 2 |
| **File hooks** | Which files can be accessed | Read/Grep hooks block secret files; guard hook blocks `lrail.yml` |
| **Config visibility** | Whether agents know the rules | `visible: false` hides the config from all tools |
| **Bash proxy** | Workflow-specific permissions | `lrail <id> bash` adds workflow policy on top of project policy |
| **Secret mediation** | Credential exposure | Values injected into subprocess env, redacted from all output |
| **Audit log** | Accountability | Every command, every decision, every source — recorded |

The hook protocol uses **exit 2** (blocking error), which overrides the Claude Code allow list and works in all permission modes including `bypassPermissions`. This isn't a suggestion the agent can ignore — it's a structural gate.

### Structural enforcement for custom agents

For maximum isolation, restrict an agent's tools to `Bash(lrail *)` via `allowed-tools`. The agent can only execute commands through the proxy — no direct shell access. Policy enforcement becomes structurally impossible to bypass, not just difficult.

---

## Getting Started

### As a Claude Code Plugin (recommended)

```bash
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

Start a new session. You're protected.

### As a CLI tool

```bash
npm install llm-rail
lrail init
```

### CLI Reference

```bash
# Guardrails
lrail init                                            # Initialize (auto on plugin install)
lrail policy eval --command '<cmd>'                   # Test a command against policy
lrail log [-n <count>] [-f] [--raw]                   # Command history
lrail bash '<command>'                                # Execute through global proxy

# Workflow management
lrail wf list                                         # List workflows
lrail wf <name> create [--variant <v>] [--param k=v]  # Create instance
lrail wf <name> validate [--variant <v>]              # Validate YAML
lrail wf <name> promote                               # Check promotion readiness

# Instance execution
lrail <id> start                                      # Begin execution
lrail <id> next --result '<json>'                     # Submit step result
lrail <id> status                                     # Check progress
lrail <id> bash '<command>'                           # Execute through proxy
lrail <id> policy generate                            # Generate policy from trail
```

---

## Claude Code Plugin

| Skill | What it does |
|---|---|
| `/llm-rail:design` | Describe a task → get a validated workflow |
| `/llm-rail:build` | Generate, optimize, and test a workflow automatically |
| `/llm-rail:run` | Execute a workflow end-to-end |
| `/llm-rail:review` | Trial run + analysis — detect issues, suggest fixes |
| `/llm-rail:optimize` | 7-step optimization pipeline with variant output |

The framework builds and improves its own workflows — it's self-hosting.

---

<p align="center">
  <strong>Prompt-level safety is a sticker on a dashboard. Structural safety is the seatbelt.</strong>
  <br>
  LLM Rail builds the seatbelt.
</p>
