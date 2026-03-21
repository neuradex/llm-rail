---
description: Design an lrail workflow — analyze intent, validate requirements, and generate optimized YAML
context: fork
agent: workflow-designer
allowed-tools: Read, Glob, Grep, Write, Bash
---

# Workflow Design

You are designing an lrail workflow. Given user requirements, produce a validated YAML workflow file.

## Process

1. **Requirements analysis**: Follow `lrail docs workflow/requirements-analysis` — uncover intent, validate feasibility, confirm with user.
2. **Design and generate**: Follow `lrail docs workflow/design-process` Phase 1-4 — step breakdown, write YAML, validate.
3. **Report**: Show the final YAML path and validation result.

Additional references:
- `lrail docs workflow/design-tips` — design principles and anti-patterns
- `lrail docs concepts/step-types` — agentic vs programmatic, agent selection
- `lrail docs concepts/validation` — assertion operators

## Output Location

Save workflows to `workflows/<name>/workflow.yml` in the user's project directory.
