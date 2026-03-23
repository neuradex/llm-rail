---
name: policy
description: Command control — trail mode for observation, enforce mode for lockdown
---

## Policy

Policy controls what shell commands agents can run. Two layers:

1. **Project config** (`lrail.yml`) — applies to all commands from any source. The main agent's Bash calls are intercepted via a PreToolUse hook and checked against this policy before execution.
2. **Workflow policy** (`policy:` in workflow YAML) — additional per-workflow rules applied when commands go through the bash proxy (`lrail <id> bash`).

Both layers are evaluated in order: project policy first, then workflow policy. A deny at either layer blocks the command.

### Config file resolution

`lrail.yml` is resolved by walking up the directory tree from the current working directory. The first `lrail.yml` found is used. This means:

- A single `~/lrail.yml` applies to all projects
- A project-level `lrail.yml` overrides the global one for that project
- Subdirectories inherit the nearest parent's config

When the llm-rail plugin is installed, `lrail.yml` is auto-created on session start if none is found in any parent directory.

### lrail.yml structure

```yaml
# Controls agent access to this config file (Read/Edit/Write/Bash).
# false (default): agents cannot see or modify this file.
# true: agents can read and modify this file.
visible: false

policy:
  mode: enforce
  default: allow
  rules:
    - effect: deny
      commands: [...]

env:
  secret_files: [.env]
```

Legacy flat format (without `policy:` wrapper) is also supported for backward compatibility.

### visible field

Controls whether agents can access `lrail.yml` itself:

- `visible: false` (default) — Read, Edit, Write tools are all blocked. Agents cannot see what rules exist.
- `visible: true` — all access allowed. Agents can read the config and adapt their behavior.

Bash commands targeting `lrail.yml` are controlled by a separate policy rule (included in the default template). Remove that rule if you set `visible: true` and want agents to manage the config via shell commands as well.

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

### Pattern types

Commands support two pattern types:

**Glob** (default) — simple wildcard matching. `*` matches any characters.

```yaml
commands:
  - "rm -rf *"
  - "sudo *"
  - "chmod 777 *"
```

**Regex** — full regular expression for precise matching. Use when glob is too coarse (e.g., catching flag reordering, absolute path bypass).

```yaml
commands:
  - regex: "rm\\s+(-[a-z]*r[a-z]*\\s+.*-[a-z]*f|.*-[a-z]*f[a-z]*\\s+.*-[a-z]*r|.*-[a-z]*rf)"
  - regex: "(^|/)sudo\\s+"
  - regex: "git\\s+push\\s+.*--force"
```

Glob and regex can be mixed in the same rule:

```yaml
rules:
  - effect: deny
    commands:
      - "chmod 777 *"                    # glob
      - regex: "git\\s+push\\s+.*--force"  # regex
```

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

### Testing policy rules

Evaluate a command against the project config:

```bash
lrail policy eval --command 'curl https://example.com'
```

Exit code 0 = allowed, 1 = denied.

### Hook protocol

LLM Rail hooks use the Claude Code hook protocol:

- **exit 0** — allow (tool proceeds)
- **exit 2 + stderr** — blocking error (tool blocked, message fed to agent)
- **exit 1** — non-blocking error (ignored, tool proceeds)

This applies to all hooks (Bash, Read, Grep, Edit, Write). Exit 2 overrides the Claude Code allow list and works in all permission modes.

### Environment variable mediation

Policy can include an `env` section for secret mediation. See `lrail docs concepts/secrets` for full details.

```yaml
env:
  inject: [API_KEY, SERPER_KEY]
  passthrough: [PATH, HOME, LANG]
  secret_files: [.env, ~/.aws/credentials]
```

When env mediation is active (`inject` or `secret_files`):
- All Bash calls are forced through `lrail bash` (PreToolUse hook denies bare bash)
- Proxy subprocess receives only permitted env vars
- Output is scanned and secret values replaced with `[REDACTED]`
- Read/Grep hooks block access to `secret_files` paths

### Policy is required for stable phase

When a workflow reaches `phase: stable`, policy must be in `enforce` mode. This is validated by `lrail wf <workflow> validate`.
