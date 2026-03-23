#!/bin/bash
# LLM Rail — Block modifications to lrail.yml (the policy file itself).
# Used by Edit/Write PreToolUse hooks.
#
# Reads file_path from stdin JSON, blocks if it resolves to lrail.yml.
# exit 0 → allow | exit 2 + stderr → block

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Resolve to absolute path
RESOLVED=$(cd "$(dirname "$FILE_PATH" 2>/dev/null)" 2>/dev/null && echo "$(pwd)/$(basename "$FILE_PATH")" || echo "$FILE_PATH")
POLICY_FILE=$(pwd)/lrail.yml

if [ "$RESOLVED" = "$POLICY_FILE" ]; then
  echo "LLM Rail: modification of lrail.yml is blocked by policy. If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
  exit 2
fi

exit 0
