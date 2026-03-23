#!/bin/bash
# LLM Rail SessionStart hook.
# 1. Ensure CLI is built
# 2. Auto-init if no lrail.yml found in any parent directory

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# 1. Build if needed
if [ ! -f "$PLUGIN_ROOT/dist/cli.js" ]; then
  (cd "$PLUGIN_ROOT" && npm install --ignore-scripts 2>/dev/null && npm run build 2>/dev/null)
fi

# 2. Walk up to check for existing lrail.yml
DIR=$(pwd)
FOUND=""
while true; do
  if [ -f "$DIR/lrail.yml" ]; then
    FOUND="$DIR/lrail.yml"
    break
  fi
  PARENT=$(dirname "$DIR")
  if [ "$PARENT" = "$DIR" ]; then
    break
  fi
  DIR="$PARENT"
done

# Auto-init if no config found
if [ -z "$FOUND" ]; then
  lrail init 2>/dev/null || true
fi

exit 0
