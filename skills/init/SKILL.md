---
description: Initialize llm-rail in the current project — set up workflows, directories, and register in CLAUDE.md
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit
---

# Project Setup

Initialize llm-rail in the current project.

## Steps

1. Create the workflows directory:
```bash
mkdir -p workflows
```

2. Copy sample workflows from the plugin:
```bash
cp ${CLAUDE_PLUGIN_ROOT}/workflows/*.yml workflows/
```

3. Add `.llm-rail/` to `.gitignore` (runtime state directory):
```bash
if [ -f .gitignore ]; then
  grep -q '.llm-rail/' .gitignore || echo '.llm-rail/' >> .gitignore
else
  echo '.llm-rail/' > .gitignore
fi
```

4. **Register llm-rail in CLAUDE.md** — inject context so the agent knows about llm-rail in every session.

First, check if CLAUDE.md already has an llm-rail section:
```bash
if [ -f CLAUDE.md ]; then
  grep -q 'llm-rail' CLAUDE.md && echo "ALREADY_EXISTS" || echo "NEEDS_INJECT"
else
  echo "NO_FILE"
fi
```

If `ALREADY_EXISTS`, skip this step.

If `NEEDS_INJECT` or `NO_FILE`, append the following block to `CLAUDE.md` (create the file if it doesn't exist). Use the Edit tool to append, or Write if the file is new.

```
## llm-rail — Agent Task Optimizer

This project uses [llm-rail](https://github.com/neuradex/llm-rail) to optimize complex agent tasks.

When a task is too complex for a single pass, or fails, or is too costly:
1. Break it into a step-by-step workflow with `/llm-rail:design`
2. Execute with `/llm-rail:run` — each step is small enough for a fast, low-cost agent (e.g. haiku)
3. Result: better reliability + cost optimization + speed optimization

### When to suggest llm-rail
- User says a task failed or the output quality is poor
- A task has multiple distinct phases that could be validated independently
- User wants to reduce cost or speed up a repeating multi-step process
- User asks to break down, structure, or systematize a complex task

### Commands
- `/llm-rail:design` — Design a new workflow from a task description
- `/llm-rail:run <workflow> [--param k=v]` — Execute a workflow end-to-end
- `/llm-rail:audit` — Review and improve an existing workflow
- `/llm-rail:status` — Check workflow instance status or list all instances
- Workflow definitions: `workflows/*.yml`
```

5. List the copied workflows with a brief description of each:
```bash
for f in workflows/*.yml; do
  name=$(basename "$f" .yml)
  desc=$(grep '^description:' "$f" | head -1 | sed 's/description: *//')
  echo "  - $name: $desc"
done
```

## Report

Report the results:
- How many workflows were copied
- The `.gitignore` status
- Whether CLAUDE.md was updated (and what was added)
- Suggest running `/llm-rail:design` to create a custom workflow
