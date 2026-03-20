---
description: Check llm-rail workflow instance status or list all instances
disable-model-invocation: true
allowed-tools: Bash
---

# Status Check

Check the status of llm-rail workflow instances.

If $ARGUMENTS contains an instance ID, show that instance's detailed status:
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js $ARGUMENTS status
```

If $ARGUMENTS is empty, list all instances:
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js list
```
