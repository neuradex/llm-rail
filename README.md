<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>Guardrails for agentic work.</strong>
</p>

<p align="center">
  <a href="#why-rails">Why Rails</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#claude-code-plugin">Plugin</a> ·
  <a href="./docs/CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="./docs/README.ko.md">한국어</a> ·
  <a href="./docs/README.ja.md">日本語</a>
</p>

---

Ruby on Rails laid rails for web development. **LLM Rail lays rails for agentic work.**

The word "rail" carries a dual meaning — and both are intentional:

- **Rail as track**: Pre-defined workflow steps that agents run on. Fast, efficient, no wasted motion.
- **Rail as guardrail**: Structural controls that prevent agents from going off course.

LLM agents choke on complex tasks. They skip steps, hallucinate outputs, and lose track of what they were supposed to do as context grows. Throwing a bigger model at it costs more — with no guarantee it'll work. The root cause: **LLMs have recency bias**. In a long context, they forget the original instructions and drift.

Current approaches to AI safety amount to **stickers on a dashboard** — prompt-level warnings like "be careful" and "don't make mistakes." LLM Rail takes a different approach: **structural safety**. Build execution structures where bad things *can't* happen, instead of asking models to be good.

**LLM Rail** fixes this with three layers of rails:

| Rail | What it controls |
|---|---|
| **Workflow Rail** | Decompose tasks into validated steps. Each step runs in a narrow context — small enough for Haiku instead of Opus. |
| **Policy Rail** | Every shell command goes through a bash proxy with IAM-style allow/deny rules. Agents can only do what's explicitly permitted. |
| **Audit Rail** | Every action, command, and validation — logged. Full traceability per instance. |

Think of it as **Convention over Configuration for the LLM era**. Rails defined "how to build web apps" with MVC. LLM Rail defines "how to run AI agents" with workflow decomposition + execution control + audit trail. Opus designs the workflows. Haiku runs on them.

Your AI agent failed a complex code review? Break it into 3 validated steps. Run each with Haiku. Total cost drops from $2 to $0.08. Every output verified. Full audit trail.

---

## Why Rails

LLMs have **recency bias** — the longer the context, the more they forget their original instructions ([Peysakhovich & Lerer 2023](https://arxiv.org/abs/2310.01427), [Liu et al. 2023](https://arxiv.org/abs/2307.03172)). This is the fundamental failure mode of complex agentic tasks.

Existing frameworks like LangChain and CrewAI handle orchestration — but not **execution control and audit trail** at the framework level. They tell agents *what* to do, but not *how much they're allowed to do*. LLM Rail fills this gap.

LLM Rail solves the recency problem by **keeping each step's context small and focused**:

- Each step gets a clean agent with only the data it needs via `context_in`
- No accumulated context pollution from prior steps
- The agent doesn't need to be smart — it just needs to follow a narrow instruction precisely

This is why **Haiku can replace Opus**. It's not about model capability — it's about scope. A small model in a small context outperforms a large model drowning in a large context.

And because the workflow engine — not the LLM — tracks progress, **every step executes without exception**, even in a workflow with hundreds of steps. An LLM agent in a long context will inevitably skip steps. A workflow engine never forgets.

For enterprises, this answers three critical questions: **"Can it handle complex processes?"** — yes, the engine guarantees every step completes. **"Can you control it?"** — yes, with policy rails. **"Can you trace issues?"** — yes, with audit rails. All answered at the architecture level, not with prompt-level promises.

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
  └── policy.jsonl     # All command executions
```

---

## Feature Summary

| | |
|---|---|
| **Step Types** | `programmatic` (no LLM, direct execution) and `agentic` (LLM agent with validation) in one workflow. |
| **Actions** | `js:` (JavaScript with auto-injected context) and `shell:` (template interpolation + JSON extraction). Pipe-style data flow between chained actions. |
| **Policy** | AWS IAM-inspired allow/deny rules with trail and enforce modes. Bash proxy for all agent commands. |
| **Validation Gates** | 22 built-in operators. Structural validation + business logic assertions + `verify_source` anti-fabrication + `script` custom logic. |
| **Explicit Data Flow** | `context_in` passes only needed data between steps — no implicit merging, no context pollution. |
| **Accumulate Mode** | Incremental data collection with dedup-by-key merging. Quality gate keeps the step open until validation passes. |
| **Variants** | Multiple workflow designs coexist, compare, and merge. ID-based step merging with `extends: base`. |
| **Lifecycle Phases** | `draft` → `dev` → `stable` progression with promotion analysis. |
| **Lifecycle Hooks** | Gate and event hooks at every stage (`step:before_start`, `step:completed`, `policy:denied`, etc.). |
| **Audit Logs** | Every event recorded in JSONL. Audit + policy logs per instance for full traceability. |
| **Claude Code Plugin** | Built-in skills & agents — design, run, and audit workflows without leaving the editor. |

---

## Getting Started

### Install

```bash
npm install llm-rail
```

### As a Claude Code Plugin

```bash
claude install llm-rail
```

Then run `/llm-rail:init` in your project to set up workflows and register in `CLAUDE.md`.

### CLI Reference

```bash
# Browse documentation
lrail docs [topic]

# Workflow management
lrail wf list                                       # List all workflows
lrail wf instances [--status <status>]              # List all instances
lrail wf <name> create [--variant <v>] [--param k=v]  # Create instance
lrail wf <name> validate [--variant <v>]            # Validate workflow YAML
lrail wf <name> show [--variant <v>]                # Show workflow YAML
lrail wf <name> variants                            # List variants
lrail wf <name> merge <variant> [--backup <name>]   # Merge variant into base
lrail wf <name> list [--status <status>]            # List instances
lrail wf <name> promote                             # Suggest phase promotion
lrail wf <name> policy check --command '<cmd>'      # Dry-run policy check

# Instance execution
lrail <id> start                                    # Begin execution
lrail <id> next --result '<json>'                   # Submit step result
lrail <id> status                                   # Check progress
lrail <id> query [--step <stepId>]                  # Query instance state
lrail <id> reset <step-id>                          # Reset a step
lrail <id> log [step-id] [-f]                       # Show audit log
lrail <id> bash '<command>'                         # Execute through policy proxy
lrail <id> summary                                  # Workflow summary with warnings
lrail <id> policy generate                          # Generate policy from trail

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
  <strong>Safe AI = building structures where bad things can't happen, not asking models to be good.</strong>
  <br>
  Define the rails. Let cheap models run on them — fast, safe, and transparent.
</p>
