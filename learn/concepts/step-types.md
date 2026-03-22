---
name: step-types
description: Agentic vs programmatic steps — when to use which
---

## Step Types

Each step has a `type` field: `agentic` (default) or `programmatic`.

### agentic

An agent does the work. Requires `instruction` and `required_output`. `description` is optional (used for status display).

- **`instruction`** — the actual directive for the agent (what to do). Supports `{{param}}` interpolation.
- **`description`** — optional human-readable summary shown in status/list output. If omitted, `id` is used.

```yaml
- id: news-analysis
  description: Analyze recent news
  instruction: "Collect recent news and assess sentiment"
  required_output: [analyses]
  tips:
    - Focus on news from the last 3 months
```

Good for: research, judgment, synthesis, creative work.

### programmatic

The CLI auto-executes shell commands. No agent involved. Requires `actions`.

```yaml
- id: screen-candidates
  type: programmatic
  actions:
    - run: |
        node -e '
          const data = JSON.parse(process.env.CONTEXT);
          const filtered = data.items.filter(x => x.score > 80);
          console.log(JSON.stringify({ result: filtered }));
        '
      extract:
        result: result
```

Good for: filtering, sorting, arithmetic, API calls, data transformation.

## How to decide

| If the step involves... | Use |
|---|---|
| Searching the web | agentic |
| Filtering data by criteria | **programmatic** |
| Writing analysis or summaries | agentic |
| Calling an API with known parameters | **programmatic** |
| Making subjective judgments | agentic |
| Sorting, ranking, arithmetic | **programmatic** |

**Rule of thumb**: If you can write it as a shell command that always produces the correct output, it should be programmatic. If the step requires understanding, interpretation, or exploration, keep it agentic.

## Step Execution Chain

When a result is submitted via `lrail <id> next --result`, the following chain executes in order:

```
1. Parse JSON result
2. Accumulate merge (if step has accumulate config)
3. Resolve templates in validation/assertion values ({{param}}, {step.field})
4. Run validation rules
   → fail: reject (accumulate: save pool + stay in step)
5. Fire before_complete hook (can block)
6. Run actions (if defined — works on agentic steps too)
   → extracted values merge into step output
7. Mark step completed
8. Run assertions (post-completion checks)
   → fail: revert step to in_progress, agent retries
9. Advance to next step (auto-execute programmatic steps)
```

Key points:
- **Actions on agentic steps**: agentic steps can define `actions` that auto-execute after validation passes. Use this for derived computations (e.g., counting items that match a condition).
- **Validation vs assertions**: validation blocks completion. Assertions revert it after the fact.
- **Template resolution in gates**: validation values like `min_length: "{{min_companies}}"` or `min_length: "{step1.count}"` are resolved before evaluation.

## Agent Selection for Agentic Steps

Agentic steps are executed by a sub-agent. The agent type determines what tools are available:

| Agent type | Tools | Use when |
|---|---|---|
| `step-runner` | Read, Glob, Grep, Bash | Code-focused workflows (file analysis, local data) |
| `general-purpose` | All tools (incl. WebSearch, WebFetch) | Workflows requiring web data collection |

**step-runner cannot access the web** (no WebSearch/WebFetch). If tips mention web searches, URLs, or external data sources, the orchestrator must use `general-purpose` instead.

## Why this matters

In benchmarks, LLMs (especially smaller models like Haiku) fabricated financial data and manipulated numbers to pass validation. Programmatic steps eliminate this risk structurally — bad things literally cannot happen.

This is the difference between "stickers on the dashboard saying don't speed" (prompt instructions) and "a speed limiter in the engine" (programmatic execution).

## Actions

Programmatic steps use `actions` with `run` and optional `extract`:

```yaml
actions:
  - run: "curl -s https://api.example.com/data"
    extract:
      items: items
      count: total
```

- `run`: shell command (supports `{{param}}` templates)
- `extract`: maps JSON keys from stdout to step output
- Context is passed via `CONTEXT` env var (JSON)
- Multiple actions run sequentially; each can use previous extractions
