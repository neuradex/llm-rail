#!/bin/bash
# LLM Rail — Guard lrail.yml from agent access (Read/Edit/Write).
#
# Controlled by the `visible` field in lrail.yml:
#   visible: false (default) — agents cannot read or modify lrail.yml
#   visible: true            — agents can read and modify lrail.yml
#
# exit 0 → allow | exit 2 + stderr → block

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

# visible: true → allow all access
if lrail policy visible 2>/dev/null; then
  exit 0
fi

echo "LLM Rail: access to lrail.yml is blocked (visible: false). If this is a misconfiguration, ask the user to set 'visible: true' in lrail.yml." >&2
exit 2
