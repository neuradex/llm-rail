---
name: validation
description: Declarative guards and cross-step assertions
---

## Validation

Two tiers of output checking, both declarative.

### validation (pre-completion guards)

Checked when the agent submits with `next`. Rejected submissions don't advance the workflow.

```yaml
validation:
  - field: companies
    op: type
    value: array
  - field: companies
    op: min_length
    value: 20
    message: "Must collect at least 20 companies"
  - field: companies
    op: each_has
    value: ticker
```

### assertions (post-completion checks)

Checked after validation passes. Failures revert the step.

```yaml
assertions:
  - field: total_weight
    op: eq
    value: 100
    message: "Allocation weights must sum to exactly 100"
```

### Available operators

| Op | Description | Value |
|---|---|---|
| `exists` | Field is present | — |
| `not_empty` | Non-null, non-empty | — |
| `type` | Type check | `array`, `object`, `string`, `number` |
| `min_length` / `max_length` / `length` | Length check | number |
| `min` / `max` / `between` | Numeric range | number or `[min, max]` |
| `eq` / `neq` | Equality | any |
| `gt` / `gte` / `lt` / `lte` | Comparison | number |
| `contains` / `not_contains` | Substring or array inclusion | any |
| `matches` | Regex match | pattern string |
| `one_of` | Value in list | array |
| `each_has` | Every array item has field | field name |
| `verify_source` | Fetch URL, check per-field snippets exist | `{ url_field, field_snippets }` |
| `script` | Run shell command, exit 0 = pass | shell command string |

### verify_source — anti-fabrication guard

Each data field gets its own snippet. The agent submits a verbatim text excerpt from the source page for each field, and the CLI verifies both that the snippet contains the claimed value and exists on the page.

```yaml
validation:
  - field: financials
    op: verify_source
    value:
      url_field: source_url
      field_snippets:
        per: per_snippet    # per_snippet must contain the PER value
        roe: roe_snippet    # roe_snippet must contain the ROE value
    message: "Data source could not be verified"
```

The agent must submit for each array item:
- `source_url` — the page URL where data was found
- `per_snippet` — verbatim excerpt containing the PER value (e.g., `"PE Ratio 17.33"`)
- `roe_snippet` — verbatim excerpt containing the ROE value (e.g., `"Return on equity (ROE) is 14.48%"`)

Per-field snippets allow values that appear in different sections of the same page.

Verification order:
1. **Value check** — each snippet must contain the string representation of its data field's value (null fields are skipped)
2. **URL fetch** — CLI fetches the URL once and checks all snippets exist in the page body

**Note**: Adds network latency to validation (one HTTP request per array item). Use only on steps where data integrity is critical.

### script — custom validation via shell

Run arbitrary shell commands as assertion gates. The command receives:
- `FIELD_VALUE` env var: JSON value of the field being validated
- `CONTEXT` env var: full step output data as JSON (assertions only, payloads ≤ 8KB)
- `CONTEXT_FILE` env var: path to a temp JSON file with the same data (for payloads > 8KB; `CONTEXT` is unset in this case)

Exit code 0 = pass, non-zero = fail. stderr is used as the error message.

**Handling large context**: When using Node.js scripts, read context safely:
```javascript
node -e '
const fs = require("fs");
const ctx = process.env.CONTEXT
  ? JSON.parse(process.env.CONTEXT)
  : JSON.parse(fs.readFileSync(process.env.CONTEXT_FILE, "utf8"));
// use ctx...
'
```

```yaml
assertions:
  - field: ratio
    op: script
    value: |
      echo $CONTEXT | python3 -c "
        import sys, json
        d = json.load(sys.stdin)
        if d['ratio'] <= d['baseline_ratio']:
          print('ratio must improve over baseline', file=sys.stderr)
          sys.exit(1)
      "
    message: "Optimization must improve programmatic ratio"
```

Use `script` for comparison logic that can't be expressed with built-in operators (e.g., comparing against baseline metrics from a previous step).

**Logging**: Script execution results (stdout, stderr, exit code) are automatically recorded as `script_assertion` events in the instance audit log (`audit.jsonl`). Use `lrail <id> query` or read the log file directly to inspect results:

```jsonl
{"event":"script_assertion","step_id":"synthesize","data":{"logs":[{"field":"ratio","command":"...","exit_code":0,"stdout":"...","stderr":""}]}}
```

### When to use which

- **validation**: structure checks (is it an array? does it have required fields?)
- **assertions**: cross-step integrity (do weights sum to 100? does output reference valid IDs?)

Both are declarative — no code to write, just YAML rules.
