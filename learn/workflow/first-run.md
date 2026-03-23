---
name: first-run
description: Your first workflow from scratch
---

## Your First Workflow

### 1. Create the YAML

```bash
# workflows/hello.yml
```

```yaml
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

### 2. Validate

```bash
lrail wf hello validate
```

### 3. Create an instance

```bash
lrail wf hello create
# → Instance created: 0321-143022
```

### 4. Start

```bash
lrail 0321-143022 start
```

This shows the first step's description, required output, and the exact `next` command to run.

### 5. Submit results

```bash
lrail 0321-143022 next --result '{"message": "Hello, world!"}'
```

If validation passes, the next step starts automatically. If rejected, fix and resubmit.

### 6. Check status

```bash
lrail 0321-143022 status
```

### Key commands

```bash
lrail init                           # Initialize project (lrail.yml, workflows/, .gitignore)
lrail wf list                        # List all workflows
lrail wf <workflow> list             # List instances
lrail wf <workflow> create           # Create instance
lrail wf <workflow> validate         # Check YAML
lrail <id> start                     # Begin first step
lrail <id> next --result '<json>'    # Submit and advance
lrail <id> status                    # Check progress
lrail <id> reset <step-id>           # Reset a step
lrail log [-n <count>] [-f] [--raw]  # Command history
```
