---
name: secrets
description: Secret mediation — proxy-mediated access control for environment variables
---

## Secret Mediation

LLM agents executing shell commands can access environment variables containing API keys, tokens, and credentials. Secret mediation prevents agents from **seeing** secret values while still allowing them to **use** secrets in commands.

### How it works

1. Agent writes normal shell: `lrail bash 'curl -H "Authorization: $API_KEY" https://api.example.com'`
2. Proxy builds a subprocess with only permitted env vars
3. Shell resolves `$API_KEY` naturally inside the subprocess
4. Proxy scans stdout/stderr for secret values → replaces with `[REDACTED]`
5. Agent receives the API response with any secret values redacted

The agent never sees the actual secret value. It uses `$VAR` syntax as usual — the proxy handles isolation and redaction transparently.

### Configuration

Add `env` to your project policy (`lrail.yml`):

```yaml
# lrail.yml
mode: enforce
default: allow
env:
  inject:              # secret vars from process.env — injected + redacted
    - CI_API_KEY
  passthrough:         # non-secret vars — optional explicit allowlist
    - PATH
    - HOME
    - LANG
  secret_files:        # .env files — auto-parsed for secrets, paths blocked from Read/Grep
    - .env
    - .env.local
    - ~/.aws/credentials
rules:
  - effect: deny
    commands: ["rm -rf *", "sudo *"]
```

### Auto-derived secrets from secret_files

`secret_files` entries are parsed as `.env`-style files (`KEY=VALUE`, `KEY="VALUE"`, `export KEY=VALUE`, `# comments`). All key-value pairs found are:

1. **Injected** into the proxy subprocess env (so `$VAR` works in commands)
2. **Redacted** from stdout/stderr output
3. Used for **file content scanning** (Read/Grep hooks)

This means `secret_files` alone is sufficient — no need to duplicate variable names in `inject`:

```yaml
# This is enough — API_KEY, DB_PASSWORD etc. are auto-derived from .env
env:
  secret_files: [.env]
```

`inject` is for environment variables that exist in `process.env` but not in any file (e.g., CI secrets). When both `inject` and `secret_files` define the same key, `inject` (process.env) takes priority.

### Progressive disclosure

```yaml
# Minimal: just point to your .env file
env:
  secret_files: [.env]
# → .env parsed → vars injected + redacted. .env file blocked from Read/Grep.

# Add CI-only secrets
env:
  inject: [CI_TOKEN]
  secret_files: [.env]
# → CI_TOKEN from process.env + .env file secrets, all redacted

# Maximum: env lockdown
env:
  inject: [CI_TOKEN]
  passthrough: [PATH, HOME, LANG]
  secret_files: [.env]
# → subprocess gets ONLY PATH, HOME, LANG, CI_TOKEN, + .env vars. Everything else removed.
```

### Defense layers

| # | Layer | What it does |
|---|---|---|
| 1 | **Bash proxy forced** | When env mediation is active (`inject` or `secret_files`), all Bash calls are automatically rewritten to go through `lrail bash` via the PreToolUse hook's `updatedInput`. The agent does not need to retry. |
| 2 | **Subprocess env isolation** | Proxy controls which env vars the subprocess sees. With `passthrough`: strict allowlist. Without: full env inherited. |
| 3 | **Output redaction** | stdout/stderr scanned for inject values → replaced with `[REDACTED]`. Longer values redacted first to prevent partial match pollution. |
| 4 | **Secret files blocked** | Read/Grep hooks deny access to `secret_files` paths. Read hook also scans file contents for inject values. |
| 5 | **Audit trail** | Command strings logged with `$VAR` syntax (not actual values). All proxy commands recorded in command history. |

### Global bash proxy

When env mediation is active, use `lrail bash` for all commands:

```bash
lrail bash 'curl -s https://api.example.com -H "Authorization: Bearer $API_KEY"'
```

This works without an instance context. Project policy is applied.

### Workflow-level env policy

Workflow YAML can also define `env` inside `policy:`. Project and workflow env policies are merged (union of inject, passthrough, and secret_files).

```yaml
# workflow.yml
policy:
  mode: enforce
  env:
    inject: [WORKFLOW_SPECIFIC_KEY]
  rules:
    - effect: allow
      commands: ["curl *"]
```

### CLI commands

```bash
lrail bash '<command>'              # global proxy (no instance)
lrail policy has-env                # check if env mediation is active (exit code)
lrail policy check-file <path>     # check file against secret_files + content scan
```

### Known limitations

- **Exact match redaction only** — transformed output (e.g., `echo $KEY | base64`) is not redacted. In practice, secret values rarely appear in stdout directly.
- **File content scan has 1MB limit** — files larger than 1MB skip content scanning for performance.
- **Grep path-only blocking** — Grep hook blocks `secret_files` paths but does not scan search results for secrets.
