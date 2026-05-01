---
name: validation
description: Schema-driven structural checks and residual assertion rules
---

## Two layers

v1 validation happens in two layers:

1. **Schemas** (primary) — the structural shape of every step's output is declared up front in `schemas:`. Every submission is validated against the named schema before the step completes.
2. **`validation:` / `assertions:`** (residual) — per-step rules that can't be expressed by JSON Schema alone. Mostly `script`, `verify_source`, and cross-field checks.

Most legacy `validation:` blocks disappear in v1 because structural rules (type, length, range, enum) move into the schema.

## Layer 1: schemas

```yaml
schemas:
  ResearchResult:
    type: object
    properties:
      companies:
        type: array
        items: Company
        minItems: 20
      notes: { type: string, maxLength: 500 }
    required: [companies]

  Company:
    type: object
    properties:
      ticker: { type: string, minLength: 1 }
      score: { type: number, minimum: 0, maximum: 100 }
    required: [ticker, score]

steps:
  - id: research
    type: agentic
    instruction: Find 20+ companies
    required_output: ResearchResult
```

When the agent submits, the runner validates against `ResearchResult`. Schema failures list every problem (multiple errors per submission, not just the first):

```
Step 'research' output failed validation against schema 'ResearchResult':
  - /companies must NOT have fewer than 20 items
  - /companies/3/score must be <= 100
```

The agent's step stays `in_progress` on failure so it can retry with the feedback.

### What moves into schemas

All structural operators in the legacy list are now schema keywords:

| Legacy op | Schema keyword |
|---|---|
| `type` | `type` |
| `min_length` / `max_length` / `length` | `minLength` / `maxLength` (string) or `minItems` / `maxItems` (array) |
| `min` / `max` | `minimum` / `maximum` |
| `one_of` | `enum` |
| `not_empty` (on string/array) | `minLength: 1` / `minItems: 1` |
| (required field) | `required: [...]` |

If your workflow had these rules, the `lrail wf migrate` tool folds them automatically into the generated schema.

## Layer 2: residual assertion rules

Some checks can't be expressed structurally. They stay on the step as `validation:` or `assertions:` entries.

```yaml
- id: optimize
  type: agentic
  instruction: Produce an optimized workflow
  required_output: OptimizedWorkflow
  validation:
    - field: ratio
      op: script
      value: |
        echo "$CONTEXT" | python3 -c "
          import sys, json
          d = json.load(sys.stdin)
          if d['ratio'] <= d['baseline_ratio']:
            print('ratio must improve over baseline', file=sys.stderr)
            sys.exit(1)
        "
      message: Optimization must improve over baseline
```

### Residual operators

| Op | Use |
|---|---|
| `script` | Arbitrary shell command, exit 0 = pass. Receives `FIELD_VALUE`, `CONTEXT`, `CONTEXT_FILE` env vars. |
| `verify_source` | Fetch a URL and check per-field snippets exist (anti-fabrication). |
| `contains` / `not_contains` | Substring / array inclusion (not structural) |
| `matches` | Regex match (structural-ish, but we keep it residual for now) |
| `each_has` | Every array item has a named field (could be schema-encoded but legacy ergonomics stay) |
| Cross-field comparisons | e.g. "total equals sum of parts" — expressed via `script` |

### verify_source — anti-fabrication guard

```yaml
validation:
  - field: financials
    op: verify_source
    value:
      url_field: source_url
      field_snippets:
        per: per_snippet
        roe: roe_snippet
    message: Data source could not be verified
```

For each array item the agent submits: the claimed values must appear verbatim in the declared source page. The CLI fetches the URL once per item and checks.

Use only where data integrity is critical — there is a network round-trip per item.

### script — custom validation via shell

```yaml
validation:
  - field: result
    op: script
    value: "node -e 'const d = JSON.parse(process.env.CONTEXT); process.exit(d.valid ? 0 : 1)'"
```

Script execution results are recorded as `script_assertion` events in the instance audit log (`audit.jsonl`).

## validation vs assertions

Both are declarative. The difference is timing:

- **`validation:`** — checked when the agent submits. Failure rejects the submission; the step stays `in_progress` and the agent sees the feedback.
- **`assertions:`** — checked *after* validation passes. Failure reverts the step (back to `in_progress`) so the agent retries. Use for cross-step integrity (e.g., "weights across this step's output and another step's output must sum to 100").

## When to use which

- Structural shape of the output → **schema**.
- Numeric/length/enum constraints → **schema**.
- Data has to actually exist on the web → `validation` with `verify_source`.
- Complex cross-field, cross-step, or external-tool check → `validation` or `assertions` with `script`.
- A check that fires only in specific phases or variants → `validation` (phase is a workflow-level gate, not a per-rule one).

## What disappears

Legacy validation had one awkward pattern: `required_output: [a, b, c]` as a field list **plus** `validation:` with type rules for each. You declared shape twice. In v1 you declare shape once, in the schema, and `required_output` is just the schema's name.
