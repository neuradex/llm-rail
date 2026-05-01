---
name: step-types
description: The four v1 step types and when to pick each
---

## Step Types

A v1 workflow's `steps:` array is a sequence of typed steps. Each step has a `type:` field — exactly one of:

| Type | Purpose | Who acts |
|---|---|---|
| `agentic` | Judgment, research, synthesis, creative | an external agent |
| `programmatic` | Deterministic transforms, API calls, shaping | the CLI |
| `router` | Conditional branching (incl. loops) | the CLI |
| `call` | Invoke another workflow as a function | the CLI + child instance |

Each step has an `id`, optional `description`, optional `context_in`, and type-specific fields.

## agentic

An external agent (a Claude Code subagent, another runtime, a human) produces a structured result. The CLI pauses, the agent runs, the agent submits a JSON result via `lrail <alias> next --result '<json>'`, and the CLI validates it.

Required fields:
- `instruction` — the directive.
- `required_output` — name of a schema in the `schemas:` block. The agent's submission is validated against it.

Optional:
- `context_in` — which prior step outputs (and workflow input fields) the agent should be given.

```yaml
- id: research
  type: agentic
  context_in:
    topic: "{{topic}}"
  instruction: "Research the topic and return findings."
  required_output: ResearchResult
```

## programmatic

The CLI runs actions (`js:` / `shell:`) synchronously. No agent involvement.

Required fields:
- `actions:` — a non-empty list. Each action needs a non-empty `name` and `description` (this is a regime change from legacy: the regime enforces that processing logic is always broken into named, described units).

Optional:
- `required_output` — if set, the final accumulated result is validated against the named schema.
- `context_in` — input for `js:` via `context.<key>` and for `shell:` via `{{key}}` templates.

```yaml
- id: shape
  type: programmatic
  context_in:
    items: "{research.findings}"
  required_output: ShapedItems
  actions:
    - name: dedupe
      description: Drop duplicates by id
      js: |
        const seen = new Set();
        const out = [];
        for (const x of context.items) {
          if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
        }
        return { items: out };
```

### js: actions are pure functions

The v1 `js:` action receives `context` (resolved `context_in` + piped fields from prior actions) and returns an object that becomes the step's (or action-chain's) output. There is no `lrail` object: **`lrail.set`, `lrail.get`, and `lrail.goto` are removed**. All data flows through return values and `context_in`; all control flow goes through `router`.

See `concepts/actions` for the full pipe semantics.

## router

Declarative branching. Replaces the legacy `lrail.goto` pattern with a shape that is visible to static analysis and visualizers.

```yaml
- id: gate
  type: router
  context_in:
    decision: "{classify.kind}"
  cases:
    - when: { field: "{{decision}}", op: eq, value: urgent }
      goto: fast-path
    - when: { field: "{{decision}}", op: eq, value: routine }
      goto: slow-path
  default: escalate
  max_iterations: 50   # required if any goto is backward (loops)
```

Key rules:
- `cases[]` are checked in order; first match wins.
- `default:` is **required**. No implicit fall-through.
- A goto whose target is at or before the router (a loop) requires `max_iterations`. `lrail wf compile` enforces this.
- Backward goto resets the output of every step in the `[target, router]` window so the next iteration starts clean.
- Forward goto skips the intermediate steps (they stay `pending`) and resumes sequentially from the target.

See `concepts/router` for details.

## call

Invoke another workflow as a function. Used for reuse, modularization, and recursion.

```yaml
- id: clean
  type: call
  workflow: clean-records    # name of another workflow
  inputs:
    raw: "{fetch.raw_data}"
    rules: "{{cleaning_rules}}"
  # output = child workflow's declared output, accessible as {clean.<field>}
```

- Inputs are simple references only (`"{step.field}"` or `"{{input.field}}"`). Complex transforms belong in a prior `programmatic` step.
- The child runs in a separate sub-instance. Its internal state is not visible to the parent.
- If the child pauses at an agentic step, the parent pauses too. The agent interacts with the top-level instance; routing to the nested child is handled automatically.
- Recursion is allowed. A workflow that calls itself (directly or transitively) **must declare `max_depth:`**. Compile checks this.

See `concepts/call` for details.

## How to pick

Start from the work:

| If the step... | Use |
|---|---|
| Needs judgment, exploration, synthesis | `agentic` |
| Transforms, filters, calls an API, reshapes JSON | `programmatic` |
| Chooses a branch or loops back | `router` |
| Delegates a whole chunk to another workflow | `call` |

**Rule of thumb**: if a step can be written as a shell pipeline with a reliable exit, it should be `programmatic`. If it requires interpretation, it's `agentic`. Branches are never inside an agentic `instruction` — they belong to `router`.

## Why v1 dropped `tips`, `accumulate`, and `hooks`

The legacy format had three features that turned out to be sugar layered over `programmatic` + `router`:

- **tips**: a rotating prompt-hint pool. Fold into your `instruction` directly.
- **accumulate**: a built-in batch-retry pool for agentic steps. Express the same as a recursive `call` with an input buffer (see `concepts/call`), or an explicit pool managed in `programmatic` steps.
- **workflow hooks**: unused lifecycle event scripts. Use `audit.jsonl` (already emitted) instead.

Dropping them makes the step set smaller and the static-analysis story cleaner.

## Step execution chain (agentic)

When an agent submits via `lrail <id> next --result`:

```
1. Parse JSON
2. Run validation (residual rules)
3. Validate against required_output schema
   → fail: reject, step stays in_progress, agent retries
4. Record output, advance current_step_id
5. Drive auto-steps (programmatic / router / call) to completion
   → stop at next agentic, or workflow end
```

## Agent selection

Agentic steps are driven by a subagent. The agent type determines available tools:

| Agent type | Tools | Use when |
|---|---|---|
| `step-runner` | Read, Glob, Grep, Bash | Code-focused work (file analysis, local data) |
| `general-purpose` | All tools (incl. WebSearch, WebFetch) | Work needing web data |

If an agent step's tips mention web searches, URLs, or external data, the orchestrator must launch `general-purpose`; `step-runner` has no network tools.
