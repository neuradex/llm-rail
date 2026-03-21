---
name: phases
description: Workflow lifecycle — draft → dev → stable
---

## Workflow Phases

Every workflow has a `phase` field that tracks its maturity.

```yaml
name: my-workflow
phase: draft    # or dev, stable
```

### draft (default)

The workflow structure itself is uncertain. Steps may be added, removed, or completely reworked.

- No constraints enforced
- Run it, see what happens, iterate
- Typical: first few runs of a new workflow

### dev

Steps are defined and the workflow runs successfully. Now you're refining — converting agentic steps to programmatic, tuning validation rules, adjusting tips.

- No constraints enforced (same as draft technically)
- The label signals intent: "this workflow works, I'm optimizing it"
- Use `lrail wf <workflow> promote` to see what can be improved

### stable

The workflow is finalized. Step composition and types are intentional.

- **Policy must be `enforce` mode** — agents can only run allowed commands
- Agentic steps are allowed (some tasks genuinely need agent judgment)
- Programmatic steps handle everything deterministic

## Progression

```
draft → dev → stable
  ↑       |
  └───────┘  (can always go back)
```

Phase is just a YAML field — you change it manually. `promote` helps you decide when.

## Commands

```bash
lrail wf <workflow> validate   # Shows current phase
lrail wf <workflow> promote    # Analyzes runs, suggests next phase
```
