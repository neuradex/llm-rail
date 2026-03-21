---
name: policy
description: Command control — trail mode for observation, enforce mode for lockdown
---

## Policy

Policy controls what shell commands agents can run through the bash proxy.

```yaml
policy:
  mode: trail    # or enforce
```

### trail mode

All commands are allowed and logged. Use this to observe what commands agents actually use.

```yaml
policy:
  mode: trail
```

Logs go to `.llm-rail/<workflow>/<instance>/policy.jsonl`.

### enforce mode

Deny-first evaluation. Only explicitly allowed commands can run.

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands:
        - "curl *"
        - "node *"
    - effect: deny
      commands:
        - "rm *"
```

Evaluation order: deny rules → allow rules → implicit deny.

### trail → enforce workflow

1. Run your workflow in `trail` mode a few times
2. `lrail <id> policy generate` — generates an allow-list from observed commands
3. Paste the output into your workflow YAML
4. Switch to `enforce` mode

### Bash proxy

Agents must use the bash proxy instead of running commands directly:

```bash
lrail <id> bash 'curl https://api.example.com'
```

This ensures all commands are logged and policy-checked.

### Policy is required for stable phase

When a workflow reaches `phase: stable`, policy must be in `enforce` mode. This is validated by `lrail wf <workflow> validate`.
