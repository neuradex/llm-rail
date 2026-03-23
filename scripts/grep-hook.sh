#!/bin/bash
# LLM Rail PreToolUse hook for Grep tool.
# Blocks access to secret files (path match only).
#
# Claude Code hook protocol:
#   exit 0 → allow | exit 2 + stderr → block

INPUT=$(cat)
SEARCH_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // empty' 2>/dev/null)

if [ -z "$SEARCH_PATH" ]; then
  exit 0
fi

CHECK_OUTPUT=$(lrail policy check-file "$SEARCH_PATH" 2>&1)
CHECK_EXIT=$?

if [ "$CHECK_EXIT" -ne 0 ]; then
  echo "LLM Rail: $(echo "$CHECK_OUTPUT" | head -1)" >&2
  exit 2
fi

exit 0
