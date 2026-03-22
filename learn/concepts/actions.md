---
name: actions
description: js and shell actions — programmatic execution with pipe data flow
---

## Actions

Actions are commands that run as part of a step. Used in programmatic steps (auto-executed) and optionally in agentic steps (post-validation).

There are two action types: `js:` and `shell:`.

### js: action

Runs JavaScript with automatic context injection and return extraction.

```yaml
actions:
  - js: |
      const forms = context.companies.filter(c => c.type === "form");
      return { form_count: forms.length, form_companies: forms };
```

- `context` object is injected automatically — no `JSON.parse(process.env.CONTEXT)` needed
- `return` value becomes extracted output — no `extract:` needed, no `console.log(JSON.stringify(...))`
- Context is passed via temp file — no env var size limits
- `extract:` is **not allowed** on `js:` actions (validation rejects it)

Return value rules:
- Return an object → each key becomes a step output field
- Return `null`/`undefined` or non-object → no fields extracted

### shell: action

Runs a shell command. Supports `{{param}}` template resolution and optional `extract:`.

```yaml
actions:
  - shell: "curl -s https://api.example.com/data"
    extract:
      items: items
      count: total
```

- `shell`: shell command string (supports `{{field}}` template interpolation)
- `extract`: optional mapping of JSON keys from stdout to output fields
- Context is available via `CONTEXT` env var (JSON) for small payloads, or `CONTEXT_FILE` env var (path to temp JSON file) for large payloads

### Pipe data flow

When multiple actions are chained, data flows between them pipe-style:

```yaml
actions:
  - shell: "curl -s https://api.example.com/companies"
  - js: |
      const data = JSON.parse(context.stdout);
      return data.filter(c => c.active);
  - shell: "jq '.[].name'"
  - js: |
      const names = context.stdout.trim().split('\n');
      return { companies: names, count: names.length };
```

Flow rules:

| Previous action | Next `js:` | Next `shell:` |
|---|---|---|
| `shell:` stdout | Available as `context.stdout` | Piped as stdin |
| `js:` return | Merged into `context` | Piped as stdin (JSON) |
| `shell:` with `extract:` | Extracted fields merged into `context` (overrides default pipe) | Extracted fields merged into context |

All extracted/returned values accumulate across the chain and merge into the step's output.

### Template resolution

Use `{{paramName}}` to inject workflow parameters or previously extracted values:

```yaml
actions:
  - shell: "curl -s https://api.example.com/{{market}}/stocks"
    extract:
      token: access_token
  - shell: "curl -s -H 'Authorization: Bearer {{token}}' https://api.example.com/data"
    extract:
      data: items
```

### Error handling

- Non-zero exit code → step fails, workflow enters error state
- Timeout: 30 seconds per action
- `js:` errors surface the meaningful error line (not the full Node.js stack trace)
