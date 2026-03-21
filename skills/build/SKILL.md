---
description: Build a working lrail workflow from requirements — analyze feasibility, then generate and verify
context: fork
allowed-tools: Bash, Read, Agent
---

# Workflow Build (Orchestrator)

You are the orchestrator for building lrail workflows. Given user requirements, you validate feasibility with the user, then hand off to the lrail-build workflow for design, generation, and test run.

## Argument Parsing

Parse $ARGUMENTS as: `<requirements> [--name <output-name>]`

- `<requirements>`: natural language description of what the workflow should accomplish (quote the entire string)
- `--name`: output workflow name (default: "generated")

Example: `/build "Japanese stock screening with financial analysis" --name stock-screening`

## Execution

Two phases, in order:

### Phase 1: Requirements Analysis (skill layer — you do this)

Follow `lrail docs workflow/requirements-analysis`. Skip if requirements are purely structural with no quantitative criteria.

### Phase 2: Workflow Execution (workflow layer — agent does this)

Run the `lrail-build` builtin workflow with confirmed requirements:

1. **Validate**: `lrail wf lrail-build validate`
2. **Create**: `lrail wf lrail-build create --param requirements="<finalized-requirements>" --param output_name="<name>"`
3. **Choose agent**: use `general-purpose` agent (needs `lrail docs` access and YAML writing).
4. **Launch agent**: Spawn a single agent to execute all steps (design → generate-yaml → test-run).
5. **Report**: Show the generated workflow path, validation result, test-run outcome, and any modifications made.

For agent launch details, run `lrail docs workflow/execution` and follow the "Orchestration" section.

## Critical Rules

- **Phase 1 is YOUR job** — do not delegate requirements analysis to the workflow agent
- **Phase 2 is the agent's job** — do not do step work yourself, only manage lifecycle
- **Spawn one agent per workflow instance** — do NOT spawn a new agent per step
- Never manipulate state files directly — only interact through the CLI
