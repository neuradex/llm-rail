---
name: execution
description: How to execute an lrail workflow instance — commands, flow, and rules
---

## Workflow Execution

### Commands

#### start — begin the first step
```bash
lrail <alias> start
```
Outputs the current step's definition:
- `description`: what to do
- `required_output`: fields you MUST produce
- `context_in`: data from prior steps
- `tips`: follow these
- The exact `next` command you need to run

`start` may auto-execute programmatic steps and skip ahead to the first agentic step. If that happens, you'll see "Auto-completed" messages before the step prompt.

#### next — submit your result and advance
```bash
lrail <alias> next --result '<json>'
```
The JSON must include ALL `required_output` fields.

On success, outputs one of:
- **Next step prompt** — the workflow continues
- **Workflow completed** — you are done

#### log — view command history
```bash
lrail log [-n <count>] [-f] [--raw]
```
Shows all commands executed through the hook (agent) and proxy (instance). Flags:
- `-n <count>`: show last N entries
- `-f`: follow mode (watch for new entries)
- `--raw`: machine-readable TSV output (timestamp, source, status, command)

#### tool — call an instance-scoped tool
```bash
lrail <alias> tool <name> [--args '<json>']
```
Calls a tool defined in the workflow's `tools` section. The tool executes its actions with the full workflow context (params + step outputs + tool args) and returns the result as JSON. Tool calls are persisted to instance state and accessible via `{_tools.<name>}` in `context_in` and assertions.

#### bash — execute shell commands through the proxy
```bash
lrail <alias> bash '<command>'
```
Use this instead of running shell commands directly. The bash proxy:
- Logs all commands for audit
- Enforces policy rules (if the workflow has a policy)
- Returns stdout/stderr from the command

### Flow

1. Run **start** to see what the first step requires
2. **Do the actual work** using your tools
3. For shell commands, use **bash** proxy
4. Build a JSON result with all required_output fields
5. Run **next** to submit
6. If rejected, read the error, fix your output, and resubmit
7. If `next` outputs a new step prompt, repeat from step 2
8. If `next` outputs "Workflow completed", **STOP IMMEDIATELY** — report what you accomplished and end. Do not run any more commands.

### Rules

- Always run **start** first. Only run it once at the beginning.
- After that, use **next** to submit and advance. `next` auto-starts the next step.
- Never fabricate data — do real work with real tools
- Follow tips — they exist for a reason
- Escape JSON properly (single quotes around JSON, escape internal quotes)
- Use `bash` proxy for all shell commands — do NOT run raw shell commands
- Do NOT run any lrail CLI commands other than start, next, tool, and bash
- If stuck on a concept, run `lrail docs <topic>` for guidance

### Orchestration

When launching an agent to execute a workflow:

1. **Validate**: `lrail wf <name> validate [--variant <v>]`
2. **Create**: `lrail wf <name> create [--variant <v>] [--param k=v]` — capture the **alias** from output
3. **Choose agent type**: see `lrail docs concepts/step-types` "Agent Selection" section
4. **Launch one agent per instance** — the agent handles all steps sequentially
5. **Report**: after agent returns, run `lrail <alias> status` and summarize results

Use `--variant` to create an instance from a named variant instead of the base workflow. See `lrail docs concepts/variants` for details.
