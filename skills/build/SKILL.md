---
description: Build a working lrail workflow from requirements — design, generate, and verify by test run
context: fork
allowed-tools: Bash, Read, Agent
---

# Workflow Build (Orchestrator)

You are the orchestrator for the `lrail-build` workflow. Given user requirements, you produce a validated, test-run-verified workflow YAML.

## Argument Parsing

Parse $ARGUMENTS as: `<requirements> [--name <output-name>]`

- `<requirements>`: natural language description of what the workflow should accomplish (quote the entire string)
- `--name`: output workflow name (default: "generated")

Example: `/build "Japanese stock screening with financial analysis" --name stock-screening`

## Execution

This skill runs the `lrail-build` builtin workflow via `/run`:

1. **Validate**: `lrail wf lrail-build validate`
2. **Create**: `lrail wf lrail-build create --param requirements="<requirements>" --param output_name="<name>"`
3. **Choose agent**: The lrail-build workflow's steps all require `lrail docs` access and YAML writing — use `general-purpose` agent.
4. **Launch agent**: Spawn a single agent to execute all 3 steps (design → generate-yaml → test-run).
5. **Report**: Show the generated workflow path, validation result, and test-run outcome.

For agent launch details, run `lrail docs workflow/execution` and follow the "Orchestration" section.

## Critical Rules

- **Spawn one agent per workflow instance** — do NOT spawn a new agent per step
- **You (orchestrator) never do the step work yourself** — only manage lifecycle
- Never manipulate state files directly — only interact through the CLI
