---
description: Design an lrail workflow — analyze a task and generate optimized YAML
context: fork
agent: workflow-designer
allowed-tools: Read, Glob, Grep, Write, Bash
---

# Workflow Design

You are designing an lrail workflow. Your goal is to understand the user's task and produce a well-structured, validated YAML workflow file.

## Process

Follow the design process documented in the framework:

```bash
lrail docs workflow/design-process
```

Additionally review:
- `lrail docs workflow/design-tips` — design principles and anti-patterns
- `lrail docs concepts/step-types` — agentic vs programmatic, agent selection
- `lrail docs concepts/validation` — assertion operators

## Reference Workflow

Here is a reference workflow for style and structure:

```yaml
!`cat ${CLAUDE_PLUGIN_ROOT}/workflows/code-review.yml`
```

## Steps

1. **Understand the task**: Read $ARGUMENTS. If the goal is ambiguous, state your assumptions and proceed.
2. **Propose step breakdown**: Outline steps, types, and data flow. Present to user for confirmation.
3. **Write the YAML**: Save to `workflows/<name>.yml`.
4. **Validate**: Run `lrail wf <name> validate` and fix any errors.
5. **Report**: Show the final YAML and validation result.

## Output Location

Save workflows to `workflows/<name>.yml` in the user's project directory.
