---
name: policy
description: Command control — trail mode for observation, enforce mode for lockdown
---

## Policy

Policy controls what shell commands agents can run. Two layers:

1. **Project policy** (`.llm-rail/policy.yml`) — applies to all commands from any source. The main agent's Bash calls are intercepted via a PreToolUse hook and checked against this policy before execution.
2. **Workflow policy** (`policy:` in workflow YAML) — additional per-workflow rules applied when commands go through the bash proxy (`lrail <id> bash`).

Both layers are evaluated in order: project policy first, then workflow policy. A deny at either layer blocks the command.

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

Logs go to `.llm-rail/<workflow>/<instance>/proxy.jsonl`.

### enforce mode

Deny-first evaluation by default. Only explicitly allowed commands can run.

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

Evaluation order: deny rules → allow rules → default.

### default field

Controls what happens when no rule matches:

```yaml
policy:
  mode: enforce
  default: allow   # allow-list → deny specific commands (deny-list approach)
  rules:
    - effect: deny
      commands: ["rm *", "sudo *"]
```

- `default: deny` (default) — deny-first. Only explicitly allowed commands can run.
- `default: allow` — allow-first. Only explicitly denied commands are blocked.

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

### Project-level policy

A project-level policy file (`.llm-rail/policy.yml`) applies to all commands — both agent (hook) and instance (proxy). Evaluate it with:

```bash
lrail policy eval --command 'curl https://example.com'
```

Exit code 0 = allowed, 1 = denied.

### Policy is required for stable phase

When a workflow reaches `phase: stable`, policy must be in `enforce` mode. This is validated by `lrail wf <workflow> validate`.
