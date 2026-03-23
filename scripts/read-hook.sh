#!/bin/bash
# LLM Rail PreToolUse hook for Read tool.
# 1. Blocks reading lrail.yml unless visible: true
# 2. Blocks access to secret files (path match + content scan).
#
# Claude Code hook protocol:
#   exit 0 → allow | exit 2 + stderr → block

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ] || [ "$FILE_PATH" = "null" ]; then
  exit 0
fi

# Check lrail.yml visibility
RESOLVED=$(cd "$(dirname "$FILE_PATH" 2>/dev/null)" 2>/dev/null && echo "$(pwd)/$(basename "$FILE_PATH")" || echo "$FILE_PATH")
DIR=$(pwd)
while true; do
  if [ -f "$DIR/lrail.yml" ]; then
    POLICY_FILE="$DIR/lrail.yml"
    break
  fi
  PARENT=$(dirname "$DIR")
  if [ "$PARENT" = "$DIR" ]; then
    break
  fi
  DIR="$PARENT"
done

if [ -n "$POLICY_FILE" ] && [ "$RESOLVED" = "$POLICY_FILE" ]; then
  if ! lrail policy visible 2>/dev/null; then
    echo "LLM Rail: reading lrail.yml is blocked (visible: false). If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
    exit 2
  fi
fi

# Check secret files
CHECK_OUTPUT=$(lrail policy check-file "$FILE_PATH" 2>&1)
CHECK_EXIT=$?

if [ "$CHECK_EXIT" -ne 0 ]; then
  echo "LLM Rail: $(echo "$CHECK_OUTPUT" | head -1). If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
  exit 2
fi

exit 0
