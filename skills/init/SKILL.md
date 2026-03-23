---
description: Initialize LLM Rail in the current project — set up workflows, directories, and register in CLAUDE.md
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit
---

# Project Setup

Initialize lrail in the current project.

## Steps

1. Run the CLI init command (creates `lrail.yml`, `workflows/`, `.llm-rail/`, updates `.gitignore`):
```bash
lrail init
```

2. **Register lrail in CLAUDE.md** — inject context so the agent knows about lrail in every session.

First, check if CLAUDE.md already has an lrail section:
```bash
if [ -f CLAUDE.md ]; then
  grep -q 'lrail' CLAUDE.md && echo "ALREADY_EXISTS" || echo "NEEDS_INJECT"
else
  echo "NO_FILE"
fi
```

If `ALREADY_EXISTS`, skip this step.

If `NEEDS_INJECT` or `NO_FILE`, append the following block to `CLAUDE.md` (create the file if it doesn't exist). Use the Edit tool to append, or Write if the file is new.

```
## LLM Rail — Guardrails for Agentic Work

This project uses [LLM Rail](https://github.com/neuradex/llm-rail) to optimize complex agent tasks. `lrail` is its CLI.

LLMs have recency bias — long context leads to forgotten instructions and drift. LLM Rail fixes this by decomposing tasks into validated steps, each running in a clean, narrow context. The result: speed (Haiku instead of Opus), safety (policy + validation), and transparency (full audit trail).

### When to suggest lrail
- User says a task failed or the output quality is poor
- A task has multiple distinct phases that could be validated independently
- User wants to reduce cost or speed up a repeating multi-step process
- User asks to break down, structure, or systematize a complex task

### Quick Start
- Run `lrail docs` to browse built-in documentation (concepts, guides, tips)
- Run `lrail wf list` to see available workflows

### Commands
- `/llm-rail:design` — Design a new workflow from a task description
- `/llm-rail:run <workflow> [--param k=v]` — Execute a workflow end-to-end
- `/llm-rail:review` — Trial run + analysis — detect issues, suggest fixes, generate policy
- `/llm-rail:status` — Check workflow instance status or list all instances
- `lrail docs <topic>` — Browse documentation (e.g., `lrail docs concepts/step-types`)
- Workflow definitions: `workflows/*.yml`
```

## Report

Report the results:
- The output of `lrail init`
- Whether CLAUDE.md was updated (and what was added)
- Suggest running `/llm-rail:design` to create a custom workflow for this project
- Suggest running `lrail docs` to learn about lrail concepts
