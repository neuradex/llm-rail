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
  <a href="#what-you-get">What You Get</a> ·
  <a href="#workflow-engine">Workflow Engine</a> ·
  <a href="#security-model">Security</a> ·
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

Prompt-level safety ("please be careful") doesn't work. Agents ignore instructions as context grows. **You need structural enforcement.**

```bash
# Install the plugin. That's it.
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

Next session, every Claude Code command is guarded. No config needed.

---

## Install and Forget

LLM Rail works the moment you install it. On your next Claude Code session:

1. `lrail.yml` is auto-created with sensible defaults
2. Dangerous commands are blocked (`rm -rf`, `sudo`, `git push --force`, ...)
3. Every command the agent runs is logged
4. The config file itself is protected from agent tampering

**One file. Zero setup. Every session guarded.**

```yaml
# lrail.yml — auto-generated, edit anytime
visible: false          # agents can't see or modify this file

policy:
  mode: enforce
  default: allow        # deny-list approach: block specific commands
  rules:
    - effect: deny
      commands:
        - "rm -rf *"
        - "sudo *"
        - "chmod 777 *"
        - "git push --force *"
        - "git reset --hard *"
        - regex: "curl.*\\|\\s*(bash|sh)"   # pipe to shell
        - regex: "lrail\\.yml"              # protect this config
```

Put one `lrail.yml` in your home directory — it covers every project underneath.

---

## What You Get

### Policy enforcement

Glob patterns for simple rules. Regex for precision:

```yaml
rules:
  - effect: deny
    commands:
      - "sudo *"                                    # glob — simple
      - regex: "rm\\s+(-\\w*r\\w*\\s+)*-\\w*f"     # regex — catches rm -r -f, rm -rf, etc.
      - regex: "git\\s+push\\s+.*(--force|\\s-f)"   # regex — catches all force-push variants
```

Agents can't bypass regex rules by reordering flags or using absolute paths.

### Secret protection

Point to your `.env` file. Secrets are auto-injected and auto-redacted:

```yaml
env:
  secret_files: [.env, .env.local]
```

- Agent runs `curl -H "Authorization: Bearer $API_KEY" ...` — works normally
- But `$API_KEY` value **never appears** in agent output — replaced with `[REDACTED]`
- Agent can't `cat .env` or `grep` secret files — hooks block it

### Command audit

Every command logged. See what your agent actually did:

```bash
lrail log              # recent commands
lrail log -n 50        # last 50
lrail log -f           # follow in real-time
lrail log --raw        # machine-readable TSV
```

### Config self-protection

By default, agents can't read, edit, or write `lrail.yml`. They can't remove the rules that constrain them.

Set `visible: true` if you want agents to read the config and adapt (e.g., "this will be denied, let me try another approach"):

```yaml
visible: true   # agents can see and modify this config
```

---

## Workflow Engine

For tasks that need more than guardrails — decompose complex work into validated steps:

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

### Why this matters

LLMs have **recency bias** — the longer the context, the more they forget. In a 200-step task, an agent will inevitably skip steps. A workflow engine never forgets.

Each step gets a **narrow context** with only the data it needs. Small model, small context, precise output. **Haiku replaces Opus.** Cost drops from $2 to $0.08.

### Step types

| | Programmatic | Agentic |
|---|---|---|
| Execution | CLI runs directly | LLM agent does the work |
| Cost | Zero tokens | Minimal (scoped context) |
| Speed | Milliseconds | Seconds |
| Use when | Deterministic operations | Judgment needed |

Mix them in one workflow. Fetch data programmatically, analyze with an agent, post results programmatically.

### Validation gates

22 built-in operators. Two tiers:

- **validation** — pre-completion guards. Rejects bad output before the step completes.
- **assertions** — post-completion checks. Reverts the step on failure, agent retries automatically.

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
    op: verify_source          # fetches URLs, verifies data exists
    value: { field: "snippet", sample_size: 3 }
```

Includes `script` for custom shell-based validation — run any check you can script.

### Policy per workflow

Project-level policy protects everything. Workflow-level policy adds per-task restrictions:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl -s https://api.example.com/*", "jq *"]
    - effect: deny
      commands: ["curl *", "rm *"]
```

Only the specific API endpoints you allow. Everything else denied.

### Lifecycle & variants

Workflows mature through phases: `draft` → `dev` → `stable`

Multiple design approaches coexist as variants, get compared, and the winner merges into the base:

```bash
lrail wf code-review variants           # list variants
lrail wf code-review merge api-driven   # merge winning variant
lrail wf code-review promote            # check if ready for next phase
```

### Audit trail

Every event recorded per instance:

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # instance state
  ├── audit.jsonl      # all lifecycle events
  └── proxy.jsonl     # all command executions + policy decisions
```

---

## Security Model

LLM Rail enforces safety **structurally** — not with prompts.

```
┌─ Project Policy (lrail.yml) ─────────────────────────────┐
│                                                           │
│  Main Agent (hook)              Subagent (proxy)          │
│  ┌──────────────────┐          ┌──────────────────┐      │
│  │ PreToolUse hook   │          │ lrail <id> bash   │      │
│  │ → policy eval     │          │ → project policy  │      │
│  │ → command log     │          │ → workflow policy │      │
│  └──────────────────┘          │ → command log     │      │
│                                 └──────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

| Layer | Enforcement |
|---|---|
| **Bash** | PreToolUse hook checks every command against policy |
| **Read/Edit/Write** | Hooks guard secret files and `lrail.yml` |
| **Config** | `visible: false` prevents agents from reading the rules |
| **Bash (proxy)** | `lrail <id> bash` adds workflow-level policy on top |
| **Secrets** | Auto-injected, auto-redacted, files blocked from access |

Hook protocol uses **exit 2** (blocking error) — overrides the Claude Code allow list and works in all permission modes, including `bypassPermissions`.

### Structural enforcement for custom agents

Restrict agents to `Bash(lrail *)` via `allowed-tools`. They can **only** execute through the proxy — no direct shell access. Policy becomes structurally impossible to bypass.

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
