---
name: first-run
description: Getting started — standalone guardrails or workflow-based control
---

## Getting Started

LLM Rail can be used in two ways:

1. **Standalone guardrails** — policy enforcement + audit logging without workflows
2. **Workflow control** — decompose tasks into validated steps with full orchestration

### Standalone Guardrails (plugin install only)

Install the llm-rail plugin in Claude Code. On the next session start, `lrail.yml` is auto-created with sensible defaults:

- Dangerous commands blocked (`rm -rf`, `sudo`, `git push --force`, etc.)
- All executed commands logged
- Config file protected from agent modification

That's it. No workflows, no YAML to write. Every Claude Code session in this directory (and subdirectories) is now guarded.

To customize, edit `lrail.yml` directly:

```yaml
visible: false        # agents can't see or modify this config

policy:
  mode: enforce
  default: allow
  rules:
    - effect: deny
      commands:
        - "rm -rf *"
        - "sudo *"
        - regex: "git\\s+push\\s+.*--force"
```

A single `~/lrail.yml` in your home directory covers all projects. Project-level `lrail.yml` overrides it.

View command history:

```bash
lrail log              # recent commands
lrail log -n 50        # last 50
lrail log -f           # follow (tail)
```

### Workflow Control

For tasks that need step-by-step validation and orchestration:

#### 1. Create the YAML

```yaml
# workflows/hello.yml
name: hello
description: A simple two-step workflow
steps:
  - id: greet
    description: "Generate a greeting message"
    instruction: "Generate a warm greeting message"
    required_output: [message]
    validation:
      - field: message
        op: type
        value: string

  - id: respond
    description: "Write a response to the greeting"
    instruction: "Write a thoughtful response to the greeting message"
    depends_on: greet
    context_in:
      greeting: "{greet.message}"
    required_output: [response]
```

#### 2. Validate

```bash
lrail wf hello validate
```

#### 3. Create an instance

```bash
lrail wf hello create
# → Instance created: 0321-143022
```

#### 4. Start

```bash
lrail 0321-143022 start
```

This shows the first step's description, required output, and the exact `next` command to run.

#### 5. Submit results

```bash
lrail 0321-143022 next --result '{"message": "Hello, world!"}'
```

If validation passes, the next step starts automatically. If rejected, fix and resubmit.

#### 6. Check status

```bash
lrail 0321-143022 status
```

### Key commands

```bash
lrail init                           # Initialize project (usually auto, manual if needed)
lrail wf list                        # List all workflows
lrail wf <workflow> list             # List instances
lrail wf <workflow> create           # Create instance
lrail wf <workflow> validate         # Check YAML
lrail <id> start                     # Begin first step
lrail <id> next --result '<json>'    # Submit and advance
lrail <id> status                    # Check progress
lrail <id> reset <step-id>           # Reset a step
lrail log [-n <count>] [-f] [--raw]  # Command history
lrail policy eval --command '<cmd>'  # Test a command against policy
```
