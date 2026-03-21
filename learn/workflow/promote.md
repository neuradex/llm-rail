---
name: promote
description: How to mature a workflow through phases
---

## Promoting a Workflow

### Check current state

```bash
lrail my-workflow promote
```

This analyzes completed runs and shows:
- How many successful executions exist
- Which agentic steps used bash commands (candidates for programmatic)
- Recommended next phase

### draft → dev

When: the workflow has run successfully at least twice.

What to do:
1. Set `phase: dev` in your YAML
2. Review which agentic steps could become programmatic
3. Convert stable, deterministic steps (filtering, API calls, arithmetic)

### dev → stable

When: step types are finalized, you've tested the programmatic conversions.

What to do:
1. Run in `trail` mode to collect command logs
2. `lrail <id> policy generate` to create an allow-list
3. Add the generated policy with `mode: enforce`
4. Set `phase: stable`
5. `lrail my-workflow validate` to confirm

### Going back

Phase is just a YAML field. You can always go back to `dev` or `draft` if you need to restructure.
