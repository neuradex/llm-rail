#!/bin/bash
# LLM Rail PreToolUse hook for Bash commands.
# Reads tool input from stdin (JSON), extracts command, runs policy eval.

COMMAND=$(jq -r '.tool_input.command' 2>/dev/null)

if [ -z "$COMMAND" ] || [ "$COMMAND" = "null" ]; then
  exit 0
fi

lrail policy eval --command "$COMMAND"
