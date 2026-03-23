#!/bin/bash
# LLM Rail PreToolUse hook for Read tool.
# Blocks access to secret files (path match + content scan).
# Note: lrail.yml visibility is handled by guard-policy-file.sh (separate hook).
#
# Claude Code hook protocol:
#   exit 0 → allow | exit 2 + stderr → block

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ] || [ "$FILE_PATH" = "null" ]; then
  exit 0
fi

# Check secret files
CHECK_OUTPUT=$(lrail policy check-file "$FILE_PATH" 2>&1)
CHECK_EXIT=$?

if [ "$CHECK_EXIT" -ne 0 ]; then
  echo "LLM Rail: $(echo "$CHECK_OUTPUT" | head -1). If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
  exit 2
fi

exit 0
