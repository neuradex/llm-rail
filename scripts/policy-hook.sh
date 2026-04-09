#!/bin/bash
# LLM Rail PreToolUse hook for Bash commands.
# Reads tool input from stdin (JSON), extracts command, runs policy eval.
#
# Claude Code hook protocol:
#   exit 0 → allow
#   exit 2 + stderr → blocking error (tool blocked)
#   exit 1 → non-blocking error (ignored, tool proceeds)

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command' 2>/dev/null)

if [ -z "$COMMAND" ] || [ "$COMMAND" = "null" ]; then
  exit 0
fi

# Policy eval
EVAL_OUTPUT=$(lrail policy eval --command "$COMMAND" 2>&1)
EVAL_EXIT=$?

if [ "$EVAL_EXIT" -ne 0 ]; then
  echo "LLM Rail policy denied: $(echo "$EVAL_OUTPUT" | head -1). If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
  exit 2
fi

exit 0
