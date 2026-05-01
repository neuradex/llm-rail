---
name: actions
description: js/shell actions for programmatic steps — pure pipeline
---

## actions — the programmatic step's body

A `programmatic` step runs an ordered list of `actions`. Each action is either a `js:` block (a pure JavaScript function) or a `shell:` command. Results chain pipe-style until the whole step produces a single accumulated output.

```yaml
- id: transform
  type: programmatic
  context_in:
    items: "{fetch.items}"
  required_output: TransformResult
  actions:
    - name: parse
      description: JSON-decode and tag each item
      js: |
        const tagged = context.items.map(x => ({ ...x, tagged: true }));
        return { items: tagged };

    - name: dedupe
      description: Remove duplicates by ticker
      js: |
        const seen = new Set();
        const unique = [];
        for (const x of context.items) {
          if (!seen.has(x.ticker)) { seen.add(x.ticker); unique.push(x); }
        }
        return { items: unique, count: unique.length };
```

## Required fields

Every action must declare:

- **`name`** — a short identifier. Must be non-empty. Shows up in the graph export and audit logs.
- **`description`** — a one-line explanation of what this action does. Must be non-empty.

Then exactly one of:

- **`js:`** — a JavaScript body, executed in a fresh Node process.
- **`shell:`** — a shell command string.

`shell:` may also carry `extract:` (see below). `js:` may not — it returns values directly.

### Why `name` and `description` are required

v1 enforces a regime: processing logic is always broken into named, described units. A five-line workflow with a ten-line `js:` block and no explanation is now a compile error. This is what makes the graph export — and any external visualizer or editor — able to render a meaningful node label without guessing.

If an action is large enough to need a long description, it's usually large enough to split. A common shape is: one action to fetch / collect, one to transform, one to shape the output. Three named, described units. The runner chains them for you.

## js: actions are pure functions

The `js:` action receives `context` (the step's `context_in` merged with any piped fields from prior actions) and returns an object that merges into the step's accumulated output. There is no `lrail` object in scope: **`lrail.set`, `lrail.get`, `lrail.goto` are removed**. If user code tries to call them, a plain `ReferenceError` fires.

Data flow rules:

- `context` is read-only from the action's perspective. Mutating it does not affect other actions.
- The returned value, if a plain object, merges into:
  - the **running context** visible to the next action
  - the **step's accumulated output**
- Returning `undefined`, `null`, or a non-object contributes nothing to accumulated output. (Useful for side-effectful js without a meaningful return.)

Available Node built-ins (auto-imported): `fs` (`readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`), `child_process` (`execSync`, `execFileSync`), `path` (`join`, `resolve`, `dirname`, `basename`). Use `await fetch(...)` or any async operation — the action body is wrapped in an async IIFE.

## shell: actions

```yaml
- name: fetch-json
  description: Pull records from the API
  shell: "curl -sf https://api.example.com/{{market}}/records"
  extract:
    items: items
    count: total
```

- **`shell:`** — the command. `{{field}}` is substituted with matching fields from the running context.
- **`extract:`** — optional. If stdout is JSON, extract named keys into the step's output. Source key `.` extracts the whole parsed JSON.

The context is also exposed via env:

- `CONTEXT` env var (JSON) for payloads ≤ 8 KB
- `CONTEXT_FILE` env var (path to a temp JSON file) for larger payloads. `CONTEXT` is unset in that case.

Non-zero exit → the step fails and the workflow enters an error state.

## Pipe semantics

When multiple actions chain:

| Previous action | Next `js:` | Next `shell:` |
|---|---|---|
| `js:` return | Merged into `context` | — |
| `shell:` stdout | Available as `context.stdout` | Piped as stdin |
| `shell:` extract | Extracted fields merged into `context` | Extracted fields merged into `context` |

All extracted / returned values accumulate across the chain and merge into the step's final output, which is validated against `required_output` (if set).

## Templates in shell

`shell:` honors `{{name}}` substitution at command-compose time:

```yaml
actions:
  - name: list-files
    description: List files in the target dir
    shell: "ls {{target_dir}}"
```

Complex values (objects, arrays) are JSON-stringified before insertion. Missing names are left as literal `{{name}}` so you can spot unresolved templates in the emitted command.

## Error handling

- **Non-zero exit** (shell): step fails, workflow enters error state.
- **Thrown error** (js): same.
- **Timeout**: per-action budget is 30 seconds by default; override with the step's `timeout_ms` for heavier work.
- **`js:` error messages** are stripped to the meaningful line (no Node stack trace noise).
- **`shell:` stderr** propagates verbatim.

## When actions, when agentic

If an action can be written such that it **always produces the correct output** given its input, it belongs in a `programmatic` step. That's the whole point: deterministic transforms done by the CLI.

If the step needs understanding, judgment, or open-ended search, it's `agentic` — don't hide an LLM call behind an action.

The one exception: `shell:` calling out to an LLM API you can treat as a black-box deterministic tool (same prompt, same response at temperature 0) is fine as a `programmatic` step. You're still the one guaranteeing determinism.
