# Variants

Variants allow multiple design approaches for the same workflow to coexist, be compared, and be merged.

## Directory Structure

Workflows with variants use **directory format**:

```
workflows/stock-screening/
  workflow.yml              # Base (always the execution target)
  api-driven.workflow.yml   # Named variant
  programmatic.workflow.yml # Named variant
  v1.workflow.yml           # Archived version
```

- `workflow.yml` = the canonical definition used by `lrail wf <name> create`
- `{name}.workflow.yml` = variant or archived version
- Single-file format (`workflows/stock-screening.yml`) is still supported for backward compatibility

## Variant Definition

A variant file uses `extends: base` and defines only the differences:

```yaml
extends: base
variant: api-driven
description: "Uses direct API calls. Haiku-compatible."
params:
  api_endpoint:
    type: string
    required: true
steps:
  - id: collect
    type: programmatic
    actions:
      - shell: "curl -s {{api_endpoint}}/items"
        extract: { items: items }
```

## Merge Semantics

When a variant is applied to its base workflow:

| Field | Merge behavior |
|---|---|
| `description`, `phase` | Variant overrides if present |
| `policy` | Variant replaces entirely |
| `context` | Shallow merge: `{ ...base, ...variant }` |
| `params` | Key-level merge: same key = variant wins, new key = added |
| `steps` | ID-based matching (see below) |

### Step Merging

Steps are matched by `id`:

- **Same ID**: field-level override. Array fields (`validation`, `tips`, `actions`, `required_output`) are **replaced**, not concatenated.
- **New ID**: appended to the end.
- **Missing from variant**: preserved from base.
- **Order**: base step order is maintained.

## CLI Commands

```bash
lrail wf <name> variants                           # List available variants
lrail wf <name> show [--variant <v>]                # Show YAML (merged if variant specified)
lrail wf <name> create [--variant <v>]              # Create instance from variant
lrail wf <name> validate [--variant <v>]            # Validate merged definition
lrail wf <name> merge <variant> [--backup <name>]   # Merge variant into workflow.yml
```

The `--backup` flag on `merge` saves the current `workflow.yml` as `<name>.workflow.yml` before overwriting.

## When to Use Variants

- **Cost optimization**: Same task with different model requirements (Sonnet vs Haiku)
- **API vs search**: Direct API variant vs general web search
- **Programmatic conversion**: Replacing agentic steps with programmatic actions
- **A/B testing**: Comparing different prompt strategies or step orderings
