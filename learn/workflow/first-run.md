---
name: first-run
description: Getting started — standalone guardrails or a first v1 workflow
---

## Getting Started

LLM Rail can be used in two ways:

1. **Standalone guardrails** — policy enforcement + audit logging without workflows.
2. **Workflow orchestration** — decompose tasks into typed, schema-checked steps.

### Standalone Guardrails (plugin install only)

Install the llm-rail plugin in Claude Code. On the next session start, `lrail.yml` is auto-created with sensible defaults:

- Dangerous commands blocked (`rm -rf`, `sudo`, `git push --force`, etc.)
- All executed commands logged
- Config file protected from agent modification

No workflows, no YAML to write. Every Claude Code session in this directory (and subdirectories) is now guarded.

To customize, edit `lrail.yml` directly:

```yaml
visible: false        # agents can't see or modify this config

policy:
  mode: enforce
  default: allow
  rules:
    - effect: deny
      commands:
        - "rm -rf *"
        - "sudo *"
        - regex: "git\\s+push\\s+.*--force"
```

A single `~/lrail.yml` in your home directory covers all projects. Project-level `lrail.yml` overrides it.

View command history:

```bash
lrail log              # recent commands
lrail log -n 50        # last 50
lrail log -f           # follow (tail)
```

## Your first v1 workflow

Scope: **take a URL, fetch the page, and return a short summary**. Two steps: `fetch` (programmatic) then `summarize` (agentic).

### 1. Name the shapes

v1 workflows declare every data shape up front in a `schemas:` block. Four to define:

- `Input` — caller-supplied: `{ url }`.
- `Output` — workflow result: `{ summary }`.
- `FetchResult` — what `fetch` emits: `{ body, status }`.
- `Output` — re-used by `summarize` (its shape matches the workflow output).

### 2. Write `workflows/demo.yml`

```yaml
format: v1
name: demo
version: "0.1.0"
description: Fetch a URL and summarize the body

schemas:
  Input:
    type: object
    properties:
      url: { type: string, minLength: 1 }
    required: [url]

  Output:
    type: object
    properties:
      summary: { type: string, minLength: 20 }
    required: [summary]

  FetchResult:
    type: object
    properties:
      body: { type: string }
      status: { type: integer, minimum: 100, maximum: 599 }
    required: [body, status]

input: Input
output: Output

steps:
  - id: fetch
    type: programmatic
    context_in:
      url: "{{url}}"
    required_output: FetchResult
    actions:
      - name: http-get
        description: HTTP GET the URL, return body and status code
        js: |
          const res = await fetch(context.url);
          const body = await res.text();
          return { body, status: res.status };

  - id: summarize
    type: agentic
    context_in:
      body: "{fetch.body}"
    instruction: |
      Read the provided body text. Produce a 2–3 sentence neutral summary.
      Do not add facts that aren't in the text.
    required_output: Output
```

A few notes on what's happening:

- `format: v1` tells lrail to use the v1 runtime. Without it the file is treated as legacy and rejected by the v1 commands.
- `input: Input` means the caller's JSON is validated against `Input` at instance creation time.
- `output: Output` means the last step's output is validated against `Output` at workflow completion.
- Every action has `name` and `description`. This is required in v1 — actions are the unit of processing logic, so they need readable names.
- `context_in` is how a step asks for prior data. `{{url}}` pulls from workflow input; `{fetch.body}` pulls from step `fetch`'s output.

### 3. Compile

```bash
lrail wf demo compile --path workflows/demo.yml
```

Expected:
```
Workflow 'demo' (workflows/demo.yml) compiled successfully.
  Steps: 2
  Types: 1 agentic, 1 programmatic, 0 router, 0 call
```

If there's a typo in a schema reference, a missing router `default`, or a backward goto without `max_iterations`, `compile` catches it here — before a single step runs.

### 4. Create and run

```bash
lrail wf demo create --param url=https://example.com
# → Instance alias: <something-memorable>
lrail <alias> start
# → runs `fetch` automatically, prints the `summarize` step prompt
# do the summarization (or have an agent do it)
lrail <alias> next --result '{"summary":"The example domain is a placeholder used for illustrations in documents. It has no substantive content."}'
# → Workflow completed
```

### 5. Inspect

```bash
lrail <alias> status     # final state
lrail <alias> query      # step outputs
lrail <alias> log        # audit events
```

For visualization / external tools (Loom, etc.):

```bash
lrail wf demo graph --json --path workflows/demo.yml | less
```

This is the structured JSON shape consumers read. Nothing in it depends on parsing the YAML — every edge and node is explicit.

### 6. Iterate

Common next steps:
- Add a `router` to choose between two summary styles based on body length.
- Add a second workflow (`summarize-structured`) and `call` it from `demo`.
- Promote through phases: `draft` → `dev` → `stable`. See `workflow/promote`.

## Key commands (summary)

```bash
lrail init                                         # Initialize project
lrail wf list                                      # List all workflows
lrail wf <name> compile [--path <file>]            # v1: static checks
lrail wf <name> graph --json [--path <file>]       # v1: structured export
lrail wf <name> migrate [--path <file>]            # v1: convert legacy to v1
lrail wf <name> validate [--variant <v>]           # parse-time validation
lrail wf <name> create [--variant <v>] [--param k=v ...]  # create instance
lrail <alias> start                                # begin
lrail <alias> next --result '<json>'               # submit and advance
lrail <alias> status / query / log                 # inspect
lrail <alias> reset <step-id>                      # reset a step
lrail log [-n <count>] [-f] [--raw]                # global command history
lrail policy eval --command '<cmd>'                # test a command against policy
```

## Coming from the legacy format?

If you have prior lrail experience with the pre-1.0 format, three shifts to watch for:

- No `lrail.set / lrail.get / lrail.goto`. Data flows only through returned values and `context_in`. Control flow goes through `router`.
- No `tips`, no `accumulate`, no workflow lifecycle `hooks`. Fold tips into the instruction; use recursive `call` for accumulator patterns; read audit with `lrail log` instead of hook scripts.
- `required_output` is now a schema **name**, not an array of field names. Structural rules (type / length / range / enum) live in the schema, not a separate `validation:` block.

`lrail wf migrate <path>` automates most of the conversion for existing files and flags the spots you still need to look at.
