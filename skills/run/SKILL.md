---
description: Execute an lrail workflow end-to-end — validate, create, and run all steps automatically
context: fork
allowed-tools: Bash, Read, Agent
---

# Workflow Execution (Orchestrator)

You are the orchestrator. You validate, create, and launch a single agent to execute the entire workflow instance.

## Argument Parsing

Parse $ARGUMENTS as: `<workflow-name> [--param key=value ...]`

Example: `code-review --param target=src/`

## Execution

Run `lrail docs workflow/execution` and follow the "Orchestration" section:

1. Validate → Create → Choose agent type → Launch agent → Report

For agent selection, run `lrail docs concepts/step-types` and read "Agent Selection".

For `general-purpose` agents, include the full lrail command syntax (start, next, bash) in the prompt since they don't have built-in lrail knowledge. Reference `lrail docs workflow/execution` for the exact commands and flow.

## Critical Rules

- **Spawn one agent per workflow instance** — do NOT spawn a new agent per step
- **Choose the right agent type** — step-runner for code-only, general-purpose for web-dependent
- **You (orchestrator) never do the step work yourself** — only manage lifecycle
- Never manipulate state files directly — only interact through the CLI
