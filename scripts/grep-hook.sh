#!/bin/bash
# LLM Rail PreToolUse hook for Grep tool.
# Blocks access to secret files (path match only).

SEARCH_PATH=$(jq -r '.tool_input.path // empty' 2>/dev/null)

if [ -z "$SEARCH_PATH" ]; then
  exit 0
fi

lrail policy check-file "$SEARCH_PATH" 2>/dev/null
