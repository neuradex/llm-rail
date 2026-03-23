<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>Structural safety for AI agents.</strong>
</p>

<p align="center">
  <a href="#the-problem">The Problem</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#security-model">Security</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#claude-code-plugin">Plugin</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="./docs/README.ko.md">한국어</a> ·
  <a href="./docs/README.ja.md">日本語</a>
</p>

> **Beta (0.x.x)** — This project is under active development. APIs, CLI commands, and workflow schema may change without notice. Pin your version if you depend on stability.

---

LLM agents skip steps, hallucinate data, and run commands they shouldn't. **LLM Rail makes these failures structurally impossible** — not by asking models to be careful, but by building execution structures where bad things can't happen.

Existing agent frameworks handle orchestration — but safety is left to the prompt. "Be careful." "Don't make mistakes." These are **stickers on a dashboard**. LLM Rail takes a different approach: **structural safety at the framework level**.

| Layer | What it enforces |
|---|---|
| **Workflow** | Decompose tasks into validated steps. Each step runs in a narrow context — small enough for Haiku instead of Opus. |
| **Policy** | Every command goes through a bash proxy (`lrail <id> bash`). IAM-style allow/deny rules. Agents can only do what's explicitly permitted. |
| **Audit** | Every action, command, and policy decision — logged per instance. Full traceability. |

Your AI agent failed a complex code review? Break it into 3 validated steps. Run each with Haiku. Total cost drops from $2 to $0.08. Every output verified. Full audit trail.

---

## The Problem

LLMs have **recency bias** — the longer the context, the more they forget their original instructions ([Peysakhovich & Lerer 2023](https://arxiv.org/abs/2310.01427), [Liu et al. 2023](https://arxiv.org/abs/2307.03172)). This is the fundamental failure mode of complex agentic tasks.

Existing frameworks like LangChain and CrewAI tell agents *what* to do, but not *how much they're allowed to do*. They handle orchestration — but not **execution control and audit** at the framework level. LLM Rail fills this gap.

LLM Rail solves the recency problem by **keeping each step's context small and focused**:

- Each step gets a clean agent with only the data it needs via `context_in`
- No accumulated context pollution from prior steps
- The agent doesn't need to be smart — it just needs to follow a narrow instruction precisely

This is why **Haiku can replace Opus**. It's not about model capability — it's about scope. A small model in a small context outperforms a large model drowning in a large context.

The workflow engine — not the LLM — tracks progress, so **every step executes without exception**, even in a workflow with hundreds of steps. An LLM agent in a long context will inevitably skip steps. A workflow engine never forgets.

For enterprises: **"Can you control it?"** — policy enforced at the framework level. **"Can you trace issues?"** — full audit trail. **"Can it handle complex processes?"** — the engine guarantees every step completes. All answered structurally, not with prompt-level promises.

---

## How It Works

### Step Types

LLM Rail supports two step types in a single workflow:

```yaml
steps:
  # Programmatic: no LLM needed. CLI executes directly.
  - id: fetch-data
    type: programmatic
    actions:
      - shell: "curl -s {{api_url}}/data"
        extract: { records: "data", count: "total" }

  # Agentic: LLM agent does the work. Output validated.
  - id: analyze
    description: "Analyze {{count}} records for anomalies"
    instruction: "Analyze the records and identify anomalies with risk scoring"
    depends_on: fetch-data
    context_in:
      records: "{fetch-data.records}"
    required_output: [anomalies, risk_score]
    validation:
      - field: anomalies
        op: type
        value: array
      - field: risk_score
        op: between
        value: [0, 100]

  # Programmatic: post-processing without LLM
  - id: notify
    type: programmatic
    depends_on: analyze
    actions:
      - shell: "curl -X POST {{webhook}} -d '{\"score\": {{risk_score}}}'"
```

**Programmatic steps** execute in milliseconds with zero token cost. **Agentic steps** get a focused, validated scope that Haiku handles reliably.

### Policy System

Control what agents can execute — inspired by AWS IAM:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl *", "jq *", "node *"]
    - effect: deny
      commands: ["rm *", "sudo *"]
```

- **Trail mode**: Allow everything, log everything. For development and policy discovery.
- **Enforce mode**: Deny-first rule evaluation. For production.
- **Policy generation**: Auto-generate minimal allow-list from trail logs.

All commands go through the bash proxy (`lrail <id> bash "<cmd>"`), which enforces policy and logs every execution.

### Validation Gates

22 built-in operators check each step's output before advancing:

```yaml
validation:
  - field: file_list
    op: type
    value: array
  - field: complexity_score
    op: between
    value: [1, 10]
assertions:
  - field: comments
    op: each_has
    value: file
    message: Every comment must reference a file
```

Two tiers: **validation** (pre-completion guards) rejects bad submissions. **assertions** (post-completion checks) revert the step on failure. The agent retries with the error message — no human intervention needed.

Includes `verify_source` for anti-fabrication (fetches URLs and verifies data snippets exist on the page) and `script` for custom shell-based validation logic.

### Workflow Lifecycle

Every workflow progresses through maturity phases:

```
draft → dev → stable
```

- **draft**: Exploration. No constraints. Run it, see what happens, iterate.
- **dev**: Working workflow. Refine validation, convert agentic steps to programmatic.
- **stable**: Production-ready. Policy must be in `enforce` mode.

Use `lrail wf <name> promote` to analyze runs and get promotion recommendations.

### Variants

Multiple design approaches coexist, get compared, and merge:

```
workflows/stock-screening/
  workflow.yml              # Base (execution target)
  api-driven.workflow.yml   # Direct API approach
  programmatic.workflow.yml # Fully deterministic
```

Variants use `extends: base` and define only differences. Steps merge by ID — same ID overrides, new IDs append, missing IDs keep base. Merge a winning variant into the base with `lrail wf <name> merge <variant>`.

### Accumulate Mode

For steps that collect data incrementally:

```yaml
- id: collect
  instruction: "Collect company data in batches"
  required_output: [companies]
  accumulate:
    companies:
      key: ticker
  validation:
    - field: companies
      op: min_length
      value: 20
```

The agent submits batches. Each batch merges into a pool with deduplication by key. Validation runs against the accumulated pool — the step stays open until the quality gate passes.

### Audit Trail

Every event is recorded per instance:

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # Instance state
  ├── audit.jsonl      # All lifecycle events
  └── proxy.jsonl     # All command executions
```

---

## Feature Summary

| | |
|---|---|
| **Step Types** | `programmatic` (no LLM, direct execution) and `agentic` (LLM agent with validation) in one workflow. |
| **Actions** | `js:` (JavaScript with auto-injected context) and `shell:` (template interpolation + JSON extraction). Pipe-style data flow between chained actions. |
| **Policy** | AWS IAM-inspired allow/deny rules with trail and enforce modes. Bash proxy for all agent commands. Secret mediation with output redaction. |
| **Validation Gates** | 22 built-in operators. Structural validation + business logic assertions + `verify_source` anti-fabrication + `script` custom logic. |
| **Explicit Data Flow** | `context_in` passes only needed data between steps — no implicit merging, no context pollution. |
| **Accumulate Mode** | Incremental data collection with dedup-by-key merging. Quality gate keeps the step open until validation passes. |
| **Variants** | Multiple workflow designs coexist, compare, and merge. ID-based step merging with `extends: base`. |
| **Lifecycle Phases** | `draft` → `dev` → `stable` progression with promotion analysis. |
| **Lifecycle Hooks** | Gate and event hooks at every stage (`step:before_start`, `step:completed`, `policy:denied`, etc.). |
| **Audit Logs** | Every event recorded in JSONL. Audit + policy logs per instance for full traceability. |
| **Claude Code Plugin** | Built-in skills & agents — design, run, and audit workflows without leaving the editor. |

---

## Security Model

LLM Rail provides **structural safety** — not prompt-level "please be careful" warnings.

Policy enforcement operates in **two layers**. A project-level policy (`lrail.yml`) applies to every command across the entire project. Workflow-level policy (`policy:` in workflow YAML) adds per-workflow rules on top.

```
┌─ Project Policy (lrail.yml) ──────────────────────┐
│                                                               │
│  Main Agent (hook)              Subagent (proxy)              │
│  ┌──────────────────┐          ┌──────────────────┐          │
│  │ PreToolUse hook   │          │ lrail <id> bash   │          │
│  │ → policy eval     │          │ → policy eval     │          │
│  │ → command log     │          │ → workflow policy │          │
│  └──────────────────┘          │ → command log     │          │
│                                 └──────────────────┘          │
└───────────────────────────────────────────────────────────────┘
```

The main agent's commands are intercepted via a **PreToolUse hook** — every Bash call is checked against the project policy before execution. Subagent commands go through `lrail <id> bash`, which checks both project and workflow policy. All commands are logged to a global command history (`lrail log`).

### Structural Enforcement

Custom agents can be restricted to `Bash(lrail *)` via `allowed-tools`, meaning they **can only execute commands through the lrail bash proxy** — no direct shell access. This makes the policy layer structurally enforced, not prompt-dependent.

| | Custom Agent (e.g. `step-runner`) | General-Purpose Agent |
|---|---|---|
| Tool restriction (`allowed-tools`) | Yes — whitelist only | No — all tools available |
| Bash restriction | `Bash(lrail *)` — proxy only | Unrestricted |
| Policy enforcement | Structural (cannot bypass) | Hook-based (project policy) |
| WebSearch / WebFetch | Not available | Available |
| Project policy | Applied (via proxy) | Applied (via PreToolUse hook) |

### Two Policy Layers

**Project policy** (`lrail.yml`) — applies to all commands from any source:

```yaml
# lrail.yml
mode: enforce
default: allow
rules:
  - effect: deny
    commands: ["rm -rf *", "sudo *"]
```

**Workflow policy** (`policy:` in workflow YAML) — additional per-workflow rules on top of the project policy:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl -s https://api.example.com/*", "jq *"]
    - effect: deny
      commands: ["curl *", "rm *", "sudo *"]
```

This gives you **domain-level access control** — which URLs, which binaries, which arguments are permitted — at the framework level.

### Audit Trail

Every command is logged to a global command history with source tracking:

```bash
lrail log                # color-coded display with source tags
lrail log --raw          # machine-readable TSV output
lrail log -f             # follow mode
```

Per-instance policy decisions are also logged in `proxy.jsonl`. Even in `trail` mode (allow-all), every action is recorded for post-hoc review.

### Web Access Without Losing Control

Instead of unrestricted `WebFetch`/`WebSearch`, use `curl` through the bash proxy:

```yaml
- id: search
  type: programmatic
  actions:
    - shell: "curl -s https://google.serper.dev/search -H 'X-API-KEY: {{serper_key}}' -d '{\"q\": \"{{query}}\"}'"
      extract: { results: "organic" }
```

Programmatic steps execute through the proxy automatically. For agentic steps, the agent calls `lrail <id> bash 'curl ...'` — same policy, same audit.

### Secret Mediation

Agents often need to use API keys and credentials in commands — but shouldn't see the actual values. Secret mediation solves this through proxy-mediated access control. Just point to your `.env` file:

```yaml
# lrail.yml
env:
  secret_files: [.env, .env.local]
```

That's it. The `.env` file is auto-parsed — all key-value pairs are injected into the proxy subprocess and redacted from output. The agent uses `$VAR` syntax as usual, never sees the actual value.

```bash
# Agent writes normal shell — proxy handles the rest
lrail bash 'curl -H "Authorization: Bearer $API_KEY" https://api.example.com/data'
# → API call succeeds, but $API_KEY value never appears in agent output
```

When env mediation is active:
- All Bash calls are forced through `lrail bash` — bare bash is denied by the hook
- `secret_files` are auto-parsed and values injected into the subprocess + redacted from output
- Read/Grep hooks block agent access to secret files
- `inject` adds CI/runtime secrets from `process.env` (for vars not in any file)
- `passthrough` locks down the subprocess to only specified env vars (optional)

### Quick Start

`lrail init` generates a project policy with sensible defaults out of the box:

```bash
lrail init
# → Creates lrail.yml with deny rules for rm -rf, sudo, chmod 777,
#   git push --force, git reset --hard. Ready to use immediately.
```

Add `env.secret_files` to protect your secrets, and you have a working security setup.

### Recommended Configuration

For maximum structural safety:
1. Run **`lrail init`** to generate a project policy with default deny rules
2. Add **`env.secret_files`** to `lrail.yml` pointing to your `.env` files
3. Use **custom agents** with `allowed-tools: Bash(lrail *), Read, Glob, Grep`
4. Set **workflow policy** to **enforce mode** with explicit allow-list
5. Use `curl` through the bash proxy for web access instead of `WebFetch`/`WebSearch`
6. Review audit logs: `lrail log` (global) and `proxy.jsonl` (per-instance)

> **This area is under active development.** We are continuously exploring ways to strengthen the structural security model. Contributions and ideas are welcome. See [Contributing](./CONTRIBUTING.md).

---

## Getting Started

### Install

```bash
npm install llm-rail
```

### As a Claude Code Plugin

```bash
# Add the marketplace
/plugin marketplace add neuradex/llm-rail

# Install the plugin
/plugin install llm-rail@llm-rail
```

Then run `/llm-rail:init` in your project to set up workflows and register in `CLAUDE.md`.

### CLI Reference

```bash
# Global
lrail init                                            # Initialize project (lrail.yml, workflows/, .gitignore)
lrail docs [topic]                                    # Browse documentation
lrail log [-n <count>] [-f] [--raw]                   # Show command history
lrail bash '<command>'                                # Execute through global proxy
lrail policy eval --command '<cmd>'                   # Evaluate project-level policy
lrail policy has-env                                  # Check if env mediation is active
lrail policy check-file <path>                        # Check file against env policy

# Workflow management
lrail wf list                                         # List all workflows
lrail wf instances [--status <status>]                # List all instances
lrail wf <name> create [--variant <v>] [--param k=v]  # Create instance
lrail wf <name> validate [--variant <v>]              # Validate workflow YAML
lrail wf <name> show [--variant <v>]                  # Show workflow YAML
lrail wf <name> summary [--variant <v>] [--param k=v] # Workflow summary with warnings
lrail wf <name> variants                              # List variants
lrail wf <name> merge <variant> [--backup <name>]     # Merge variant into base
lrail wf <name> list [--status <status>]              # List instances
lrail wf <name> promote                               # Suggest phase promotion
lrail wf <name> policy check --command '<cmd>'        # Dry-run policy check

# Instance execution
lrail <id> start                                      # Begin execution
lrail <id> next --result '<json>'                     # Submit step result
lrail <id> status                                     # Check progress
lrail <id> query [--step <stepId>]                    # Query instance state
lrail <id> reset <step-id>                            # Reset a step
lrail <id> log [step-id] [-f]                         # Show audit log
lrail <id> bash '<command>'                           # Execute through policy proxy
lrail <id> policy generate                            # Generate policy from trail

# Variant management
lrail wf <name> save-variant <v> --yaml '<content>'  # Save a variant YAML file
```

---

## Claude Code Plugin

Install as a Claude Code plugin and never touch the CLI manually.

| Skill | What it does |
|---|---|
| `/llm-rail:init` | Set up LLM Rail in your project |
| `/llm-rail:design` | Describe a task in natural language → get a validated YAML workflow |
| `/llm-rail:build` | Generate and optimize workflows using built-in meta-workflows |
| `/llm-rail:run` | Execute end-to-end — a single agent runs all steps sequentially |
| `/llm-rail:review` | Trial run + analysis — detect issues, suggest fixes, generate policy |
| `/llm-rail:status` | Check progress on running workflows |
| `/llm-rail:optimize` | Optimize an existing workflow (baseline, 3 optimizations, 3-tier verification) |

### Automated Workflow Generation

Don't want to write YAML by hand? Let the framework build it for you:

- **`/llm-rail:build`** — Describe a task in natural language. The framework analyzes feasibility, generates a workflow, validates it, and runs a test execution — all automatically.
- **`/llm-rail:optimize`** — Takes an existing workflow and runs a 7-step optimization pipeline: baseline measurement → programmatic ratio improvement → execution time reduction → validation failure reduction → 3-tier model verification → synthesis report. Results are saved as a variant file, never modifying the original.

These meta-workflows use LLM Rail itself to build and improve LLM Rail workflows — the framework is self-hosting.

### What happens when you run `/llm-rail:run`

```
Orchestrator (your main agent)
  │
  ├── validate workflow → create instance
  │
  └── spawn one agent for the entire instance
        │
        ├── start → [programmatic steps auto-execute] → agentic step prompt
        ├── work → next → [programmatic steps auto-execute] → agentic step prompt
        ├── work → next → ...
        │
        └── workflow complete. every step validated. full audit trail.
```

One agent, one instance, start to finish. Each step gets a narrow, validated scope. Minimal context, minimal cost.

---

<p align="center">
  <strong>Prompt-level safety is a sticker on a dashboard. Structural safety is the seatbelt.</strong>
  <br>
  LLM Rail builds the seatbelt.
</p>
