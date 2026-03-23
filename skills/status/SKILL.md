---
description: Check LLM Rail workflow instance status or list all instances
disable-model-invocation: true
allowed-tools: Bash
---

# Status Check

Check the status of lrail workflow instances.

If $ARGUMENTS contains an instance ID, show that instance's detailed status:
```bash
lrail $ARGUMENTS status
```

If $ARGUMENTS is empty, list all instances:
```bash
lrail wf instances
```
