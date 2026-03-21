<p align="center">
  <img src="https://img.shields.io/npm/v/lrail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-private-lightgrey?style=flat-square" alt="license" />
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

Ruby on Rails laid rails for web development. **lrail lays rails for agentic work.**

The word "rail" carries a dual meaning — and both are intentional:

- **Rail as track**: Pre-defined workflow steps that agents run on. Fast, efficient, no wasted motion.
- **Rail as guardrail**: Structural controls that prevent agents from going off course.

LLM agents choke on complex tasks. They skip steps, hallucinate outputs, and lose track of what they were supposed to do as context grows. Throwing a bigger model at it costs more — with no guarantee it'll work. The root cause: **LLMs have recency bias**. In a long context, they forget the original instructions and drift.

Current approaches to AI safety amount to **stickers on a dashboard** — prompt-level warnings like "be careful" and "don't make mistakes." lrail takes a different approach: **structural safety**. Build execution structures where bad things *can't* happen, instead of asking models to be good.

**lrail** fixes this with three layers of rails:

| Rail | What it controls |
|---|---|
| **Workflow Rail** | Decompose tasks into validated steps. Each step runs in a narrow context — small enough for Haiku instead of Opus. |
| **Policy Rail** | Every shell command goes through a bash proxy with IAM-style allow/deny rules. Agents can only do what's explicitly permitted. |
| **Audit Rail** | Every action, command, and validation — logged. Full traceability per instance. |

Think of it as **Convention over Configuration for the LLM era**. Rails defined "how to build web apps" with MVC. lrail defines "how to run AI agents" with workflow decomposition + execution control + audit trail. Opus designs the workflows. Haiku runs on them.

Your AI agent failed a complex code review? Break it into 3 validated steps. Run each with Haiku. Total cost drops from $2 to $0.08. Every output verified. Full audit trail.

---

## Why Rails

LLMs have **recency bias** — the longer the context, the more they forget their original instructions ([Peysakhovich & Lerer 2023](https://arxiv.org/abs/2310.01427), [Liu et al. 2023](https://arxiv.org/abs/2307.03172)). This is the fundamental failure mode of complex agentic tasks.

Existing frameworks like LangChain and CrewAI handle orchestration — but not **execution control and audit trail** at the framework level. They tell agents *what* to do, but not *how much they're allowed to do*. lrail fills this gap.

lrail solves the recency problem by **keeping each step's context small and focused**:

- Each step gets a clean agent with only the data it needs via `context_in`
- No accumulated context pollution from prior steps
- The agent doesn't need to be smart — it just needs to follow a narrow instruction precisely

This is why **Haiku can replace Opus**. It's not about model capability — it's about scope. A small model in a small context outperforms a large model drowning in a large context.

And because the workflow engine — not the LLM — tracks progress, **every step executes without exception**, even in a workflow with hundreds of steps. An LLM agent in a long context will inevitably skip steps. A workflow engine never forgets.

For enterprises, this answers three critical questions: **"Can it handle complex processes?"** — yes, the engine guarantees every step completes. **"Can you control it?"** — yes, with policy rails. **"Can you trace issues?"** — yes, with audit rails. All answered at the architecture level, not with prompt-level promises.

---

## How It Works

### Step Types

lrail supports two step types in a single workflow:

```yaml
steps:
  # Programmatic: no LLM needed. CLI executes directly.
  - id: fetch-data
    type: programmatic
    actions:
      - run: "curl -s {{api_url}}/data"
        extract: { records: "data", count: "total" }

  # Agentic: LLM agent does the work. Output validated.
  - id: analyze
    description: "Analyze {{count}} records for anomalies"
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
      - run: "curl -X POST {{webhook}} -d '{\"score\": {{risk_score}}}'"
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

21 built-in operators check each step's output before advancing:

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

Bad output gets rejected, not passed forward. The agent retries with the error message — no human intervention needed.

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
| **Actions** | Shell commands with template interpolation and JSON extraction. Sequential with context accumulation. |
| **Policy** | AWS IAM-inspired allow/deny rules with trail and enforce modes. Bash proxy for all agent commands. |
| **Validation Gates** | 21 built-in operators. Structural validation + business logic assertions with custom error messages. |
| **Explicit Data Flow** | `context_in` passes only needed data between steps — no implicit merging, no context pollution. |
| **Lifecycle Hooks** | Gate and event hooks at every stage (`step:before_start`, `step:completed`, `policy:denied`, etc.). |
| **Audit Logs** | Every event recorded in JSONL. Audit + policy logs per instance for full traceability. |
| **Claude Code Plugin** | Built-in skills & agents — design, run, and audit workflows without leaving the editor. |

---

## Getting Started

### Install

```bash
npm install lrail
```

### As a Claude Code Plugin

```bash
claude install lrail
```

Then run `/lrail:init` in your project to set up workflows and register in `CLAUDE.md`.

### Usage

```bash
# Create a workflow instance
lrail wf code-review create --param target=src/

# Start → validate → advance, step by step
lrail 0321-143022 start
lrail 0321-143022 next --result '{"file_list":["src/main.ts"],"complexity_score":5}'

# Execute commands through policy-enforced proxy
lrail 0321-143022 bash 'git diff --stat'

# Check progress anytime
lrail 0321-143022 status

# Policy management
lrail wf code-review policy check --command 'curl https://api.example.com'
lrail 0321-143022 policy generate
```

---

## Claude Code Plugin

Install as a Claude Code plugin and never touch the CLI manually.

| Skill | What it does |
|---|---|
| `/lrail:init` | Set up lrail in your project |
| `/lrail:design` | Describe a task in natural language → get a validated YAML workflow |
| `/lrail:run` | Execute end-to-end — a single Haiku agent runs all steps sequentially |
| `/lrail:review` | Trial run + analysis — detect issues, suggest fixes, generate policy |
| `/lrail:status` | Check progress on running workflows |

### What happens when you run `/lrail:run`

```
Orchestrator (your main agent)
  │
  ├── validate workflow → create instance
  │
  └── spawn one Haiku agent for the entire instance
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
