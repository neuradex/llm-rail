#!/bin/bash
# LLM Rail PreToolUse hook for Read tool.
# Blocks access to secret files (path match + content scan).

FILE_PATH=$(jq -r '.tool_input.file_path' 2>/dev/null)

if [ -z "$FILE_PATH" ] || [ "$FILE_PATH" = "null" ]; then
  exit 0
fi

lrail policy check-file "$FILE_PATH" 2>/dev/null
