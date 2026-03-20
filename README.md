<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-private-lightgrey?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>Deterministic workflow control for LLM agents.</strong>
</p>

<p align="center">
  <a href="#getting-started">Getting Started</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#claude-code-plugin">Plugin</a> ·
  <a href="./docs/CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="./docs/README.ko.md">한국어</a> ·
  <a href="./docs/README.ja.md">日本語</a>
</p>

---

LLM agents choke on complex tasks. They skip steps, hallucinate outputs, and the bigger model you throw at it, the more it costs — with no guarantee it'll work.

**llm-rail** fixes this by decomposing the task into small, validated steps. Each step is simple enough for a fast, cheap model to handle reliably.

Your AI agent failed a complex code review? Break it into 3 validated steps. Run each with Haiku. Total cost drops from $2 to $0.08. Every output verified. Full audit trail.

| | |
|---|---|
| 📋 **YAML Workflows** | Declare steps, dependencies, required outputs, and validation rules in plain YAML. |
| ✅ **Validation Gates** | 21 built-in operators check each step's output before advancing. Reject & retry on failure. |
| 🔗 **Explicit Data Flow** | `context_in` passes data between steps — no implicit merging, no surprises. |
| 🪝 **Lifecycle Hooks** | Gate and event hooks at every stage (`step:before_start`, `step:completed`, etc.). |
| 📝 **Audit Logs** | Every event recorded in `.llm-rail/logs/<id>.jsonl` for full traceability. |
| 🤖 **Claude Code Plugin** | Built-in skills & agents — design, run, and audit workflows without leaving the editor. |

---

## How It Works

Define your workflow in YAML. Each step declares its required outputs and validation rules.

```yaml
steps:
  - id: analyze
    description: "Analyze codebase at {{target}}"
    required_output: [file_list, complexity_score]
    validation:
      - field: file_list
        op: type
        value: array
      - field: complexity_score
        op: between
        value: [1, 10]

  - id: review
    depends_on: analyze
    context_in:
      files: "{analyze.file_list}"
    required_output: [comments, severity_counts]
    assertions:
      - field: comments
        op: each_has
        value: file
        message: Every comment must reference a file
```

The agent runs step by step. At each gate, llm-rail validates the output against your rules. **Bad output gets rejected, not passed forward.**

> **21 built-in validation operators** — type checks, range constraints, regex matching, array element assertions, and more. Structural validation and business logic assertions are separated, each with custom error messages.

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

### Usage

```bash
# Create a workflow instance
llm-rail create code-review --param target=src/

# Start → validate → advance, step by step
llm-rail 0321-143022 start
llm-rail 0321-143022 next --result '{"file_list":["src/main.ts"],"complexity_score":5}'

# Check progress anytime
llm-rail 0321-143022 status
```

---

## Claude Code Plugin

Install as a Claude Code plugin and never touch the CLI manually.

| Skill | What it does |
|---|---|
| `/llm-rail:init` | Set up llm-rail in your project |
| `/llm-rail:design` | Describe a task in natural language → get a validated YAML workflow |
| `/llm-rail:run` | Execute end-to-end — each step auto-delegated to Haiku |
| `/llm-rail:audit` | Analyze an existing workflow for quality improvements |
| `/llm-rail:status` | Check progress on running workflows |

### What happens when you run `/llm-rail:run`

```
Orchestrator (your main agent)
  │
  ├── validate workflow → create instance
  │
  ├── Step 1 → spawn haiku agent → start → work → next ✓
  ├── Step 2 → spawn haiku agent → start → work → next ✓
  ├── Step 3 → spawn haiku agent → start → work → next ✓
  │
  └── done. each step validated. full audit log.
```

Each step-runner agent only knows two commands: **start** (read the task) and **next** (submit the result). Minimal context, minimal cost.

---

<p align="center">
  <strong>Stop paying for expensive models to fail at complex tasks.</strong>
  <br>
  Define the steps. Validate the outputs. Delegate to cheap models.
</p>
