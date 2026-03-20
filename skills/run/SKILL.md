---
description: Execute an llm-rail workflow end-to-end — validate, create, and run all steps automatically
context: fork
allowed-tools: Bash, Read, Agent
---

# Workflow Execution (Orchestrator)

You are the orchestrator. You validate, create, and launch a single `step-runner` agent to execute the entire workflow instance.

## CLI Path

```
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js
```

## Argument Parsing

Parse $ARGUMENTS as: `<workflow-name> [--param key=value ...]`

Example: `code-review --param target=src/`

## Execution Flow

### 1. Validate
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js validate <workflow-name>
```
If validation fails, report the errors and stop.

### 2. Create Instance
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js create <workflow-name> [--param k=v ...]
```
Capture the instance ID from the output.

### 3. Launch step-runner

Spawn **one** `step-runner` agent for the entire instance. The agent handles all steps sequentially: `start → next → (next step auto-starts) → next → ...` until the workflow completes.

Use the Agent tool with:
- `subagent_type`: `step-runner`
- `model`: `haiku`
- `prompt`: Tell it exactly two things:
  1. The CLI path: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js`
  2. The instance ID: `<id>`

  Example prompt:
  ```
  Execute this llm-rail workflow to completion.
  CLI: node /path/to/dist/cli.js
  Instance ID: 0321-143022
  ```

The step-runner calls `start`, does the work, calls `next` (which outputs the next step prompt), does the next work, calls `next` again, and so on until the workflow completes.

Programmatic steps are auto-executed by the CLI — the step-runner only interacts with agentic steps.

### 4. Final Report

After the step-runner returns, check status:
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js <id> status
```

Show the workflow completion status and a summary of what each step accomplished.
If the step-runner failed, report the error and escalate to the user.

## Critical Rules

- **Spawn one `step-runner` per workflow instance** — do NOT spawn a new agent per step
- **Always use the `step-runner` agent with model `haiku`** for step execution
- **You (orchestrator) never do the step work yourself** — only manage lifecycle
- Never manipulate state files directly — only interact through the CLI
