---
description: Review an lrail workflow — trial run, analyze results, and suggest concrete improvements
context: fork
allowed-tools: Bash, Read, Glob, Grep, Agent, Edit
---

# Workflow Review

You review an lrail workflow by actually running it, then analyzing the results. Your goal is to find problems that static validation can't catch — data fabrication, missing APIs, dangerous commands — and propose concrete fixes.

## Argument Parsing

Parse $ARGUMENTS as: `<workflow-name> [--param key=value ...]`

## Execution

Run `lrail docs workflow/review` for the full 5-phase review methodology, then follow it:

1. **Static Review** — validate + design review (step types, APIs, validation coverage)
2. **Trial Run** — create instance, choose agent type per `lrail docs concepts/step-types`, launch agent per `lrail docs workflow/execution`
3. **Output Analysis** — fabrication detection, reproducibility, step type recommendations
4. **Policy & Command Analysis** — audit bash commands, propose policy
5. **Report & Fix** — structured report, offer to apply fixes with Edit

For `general-purpose` agents, include the full lrail command syntax (start, next, bash) in the prompt. Reference `lrail docs workflow/execution` for the exact commands.

## Critical Rules

- **You (reviewer) do the analysis** — the agent only executes
- **Always run the workflow before making recommendations** — don't guess from YAML alone
- **Be specific** — "Step 2 should be programmatic" is not enough. Show the `actions` YAML.
- **Trail mode for trial runs** — never run with enforce mode
