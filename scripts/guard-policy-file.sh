#!/bin/bash
# LLM Rail — Guard lrail.yml from agent access.
# Used by Edit/Write hooks (always block) and Read hook (block unless visible: true).
#
# Usage:
#   guard-policy-file.sh          — block write (Edit/Write hooks)
#   guard-policy-file.sh --read   — block read unless visible: true
#
# exit 0 → allow | exit 2 + stderr → block

MODE="write"
if [ "$1" = "--read" ]; then
  MODE="read"
  shift
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Resolve target to absolute path
RESOLVED=$(cd "$(dirname "$FILE_PATH" 2>/dev/null)" 2>/dev/null && echo "$(pwd)/$(basename "$FILE_PATH")" || echo "$FILE_PATH")

# Walk up from cwd to find the nearest lrail.yml
DIR=$(pwd)
while true; do
  if [ -f "$DIR/lrail.yml" ]; then
    POLICY_FILE="$DIR/lrail.yml"
    break
  fi
  PARENT=$(dirname "$DIR")
  if [ "$PARENT" = "$DIR" ]; then
    exit 0
  fi
  DIR="$PARENT"
done

if [ "$RESOLVED" != "$POLICY_FILE" ]; then
  exit 0
fi

# Write is always blocked
if [ "$MODE" = "write" ]; then
  echo "LLM Rail: modification of lrail.yml is blocked by policy. If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
  exit 2
fi

# Read is blocked unless visible: true
if lrail policy visible 2>/dev/null; then
  exit 0
else
  echo "LLM Rail: reading lrail.yml is blocked (visible: false). If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
  exit 2
fi
