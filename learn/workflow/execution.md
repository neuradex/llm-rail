---
name: execution
description: How to execute an lrail workflow — commands, flow, orchestration
---

## Workflow Execution

### Runtime commands

Agents drive workflows with four commands: `start`, `next`, `tool`, `bash`. Every other `lrail` command is for authors or reviewers.

#### start — begin the first step
```bash
lrail <alias> start
```
Outputs the current step's definition:
- `instruction` (agentic) or action list (programmatic): what to do
- `required_output`: the schema name whose shape your result must match
- `context_in`: data from prior steps / workflow input made available to this step
- The exact `next` command to run once done

`start` may auto-execute programmatic steps, run `router` branches, and follow `call` steps until it reaches an `agentic` pause. If that happens you'll see "Auto-completed" lines before the step prompt.

#### next — submit your result and advance
```bash
lrail <alias> next --result '<json>'
```
The JSON must match the step's `required_output` schema (see `concepts/schemas`). Failure returns validation errors; the step stays `in_progress` and you can retry.

On success:
- **Next step prompt** — the workflow continues.
- **Workflow completed** — you are done.

#### tool — call an instance-scoped tool
```bash
lrail <alias> tool <name> [--args '<json>']
```
Calls a tool defined in the workflow's `tools` section. The tool runs its actions with the full workflow context (input + step outputs + tool args) and returns JSON. Tool calls persist to instance state as `{_tools.<name>}` and can be referenced from `context_in` or `assertions`.

#### bash — execute shell commands through the proxy
```bash
lrail <alias> bash '<command>'
```
Use instead of running shell commands directly. The proxy:
- Logs all commands for audit
- Enforces policy rules (if the workflow has one)
- Returns stdout/stderr

### Author / reviewer commands

Authors and reviewers use these before and after execution:

| Command | Purpose |
|---|---|
| `lrail wf <name> compile [--path] [--registry <dir>]` | Static checks: schemas, references, router reachability, call IO, recursion bounds |
| `lrail wf <name> graph --json [--path]` | Export structured JSON for visualizers (Loom etc.) |
| `lrail wf <name> migrate [--path] [--output] [--dry-run]` | Convert a legacy workflow to v1 (one-time ingestion) |
| `lrail wf <name> validate [--variant]` | Structural parse-time validation (subset of `compile`) |
| `lrail wf <name> show [--variant]` | Print the workflow YAML |
| `lrail wf <name> summary [--variant] [--param k=v]` | High-level summary with warnings |
| `lrail log [-n <count>] [-f] [--raw]` | Command history for the current project |

Agents don't use these during execution; they belong to the authoring / review loop.

### Execution flow (agent's perspective)

1. Run **start** to see what the first step requires.
2. **Do the actual work** with your tools.
3. For shell commands, use the **bash** proxy.
4. Build a JSON result that matches the step's `required_output` schema.
5. Run **next** to submit.
6. If rejected, read the error, fix your output, resubmit.
7. On a new step prompt, repeat from 2.
8. On "Workflow completed", **STOP IMMEDIATELY** — report what you accomplished and end. Do not run any more commands.

### Rules for agents

- Always run **start** first. Only run it once at the beginning.
- After that, use **next** to submit and advance. `next` auto-starts the next step.
- Never fabricate data — do real work with real tools.
- Escape JSON properly (single quotes around JSON, escape internal quotes).
- Use `bash` proxy for all shell commands — do NOT run raw shell commands.
- Do NOT run any lrail CLI commands other than `start`, `next`, `tool`, and `bash`.
- If stuck on a concept, run `lrail docs <topic>` for guidance.

### Orchestration (author / launcher perspective)

When launching an agent to execute a workflow:

1. **Compile**: `lrail wf <name> compile` — catches schema / router / call errors before a single step runs.
2. **Validate variant** if used: `lrail wf <name> validate --variant <v>`.
3. **Create an instance**: `lrail wf <name> create [--variant <v>] [--param k=v ...]`. Capture the **alias** from output.
4. **Choose an agent type**: see `lrail docs concepts/step-types` "Agent selection" section. step-runner for code-only; general-purpose for work needing the web.
5. **Launch one agent per instance** — the agent handles all steps sequentially via `start` / `next`.
6. **Report**: after agent returns, run `lrail <alias> status` and summarize.

`--variant` creates an instance from a named variant. See `concepts/variants`.

### What happens on `call`

If the workflow contains a `call` step, the runner transparently spawns a sub-instance for the child workflow when the step is reached. The child runs in its own instance (separate audit log, separate state), and if it hits an `agentic` step, **the parent also pauses** — the agent interacts with the top-level alias, and the runner routes submissions down to the currently-paused child.

From the agent's point of view this is invisible: `start` / `next` look the same. The only observable difference is that the step prompt may describe the child's current step instead of the parent's.

### What happens on `router`

Router steps never show a prompt to the agent. They execute instantly based on prior outputs and redirect the runner to the next step. A router may loop back (backward goto) to retry an earlier section with fresh state; `max_iterations` bounds the loop.
