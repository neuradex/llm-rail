---
name: actions
description: Shell command execution with run + extract
---

## Actions

Actions are shell commands that run as part of a step. Used in programmatic steps (auto-executed) and optionally in agentic steps (post-validation).

### Basic structure

```yaml
actions:
  - run: "echo '{\"greeting\": \"hello\"}'"
    extract:
      greeting: greeting
```

- `run`: shell command string
- `extract`: optional mapping of JSON keys from stdout to output fields

### Template resolution

Use `{{paramName}}` to inject workflow parameters:

```yaml
actions:
  - run: "curl -s https://api.example.com/{{market}}/stocks"
    extract:
      stocks: data
```

### Context via environment

The step's `context_in` data is available as `CONTEXT` environment variable (JSON):

```yaml
context_in:
  items: "{previous-step.items}"
actions:
  - run: |
      node -e '
        const ctx = JSON.parse(process.env.CONTEXT);
        const filtered = ctx.items.filter(x => x.active);
        console.log(JSON.stringify({ result: filtered }));
      '
    extract:
      result: result
```

### Chaining

Multiple actions run sequentially. Each action's extracted values merge into context for the next:

```yaml
actions:
  - run: "curl -s https://api.example.com/auth"
    extract:
      token: access_token
  - run: "curl -s -H 'Authorization: Bearer {{token}}' https://api.example.com/data"
    extract:
      data: items
```

### Error handling

- Non-zero exit code → step fails, workflow enters error state
- Timeout: 30 seconds per action
- stdout must be valid JSON if `extract` is specified
