#!/bin/bash
# LLM Rail SessionStart hook.
# Ensure CLI is built.

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

if [ ! -f "$PLUGIN_ROOT/dist/cli.js" ]; then
  (cd "$PLUGIN_ROOT" && npm install --ignore-scripts 2>/dev/null && npm run build 2>/dev/null)
fi

exit 0
