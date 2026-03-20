---
description: Execute an llm-rail workflow end-to-end — validate, create, and run all steps automatically
context: fork
allowed-tools: Bash, Read, Agent
---

# Workflow Execution (Orchestrator)

You are the orchestrator. You manage the workflow lifecycle and delegate each step to the `step-runner` agent.

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

### 3. Step Loop

For each step, delegate to the `step-runner` agent:

Use the Agent tool with:
- `subagent_type`: `step-runner`
- `model`: `haiku`
- `prompt`: Tell it exactly two things:
  1. The CLI path: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js`
  2. The instance ID: `<id>`

  Example prompt:
  ```
  Execute the current step of this llm-rail workflow.
  CLI: node /path/to/dist/cli.js
  Instance ID: 0321-143022
  ```

The step-runner will call `start` → do the work → call `next`. It handles one step and returns.

After the agent returns, check status:
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js <id> status
```

- If more steps remain `pending`, spawn another `step-runner`
- If all steps are `completed`, the workflow is done
- If a step-runner fails 3 times on the same step, escalate to the user

### 4. Final Report
Show the workflow completion status and a summary of what each step accomplished.

## Critical Rules

- **Always use the `step-runner` agent with model `haiku`** for step execution
- **You (orchestrator) never do the step work yourself** — only manage lifecycle
- Never manipulate state files directly — only interact through the CLI
