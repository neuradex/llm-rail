#!/bin/bash
# LLM Rail PreToolUse hook for Grep tool.
# 1. Blocks direct access to secret files (path match).
# 2. Injects exclusion globs for secret_files via updatedInput.
#
# Claude Code hook protocol:
#   exit 0 → allow (stdout JSON can modify input via updatedInput)
#   exit 2 + stderr → block
#
# NOTE: updatedInput REPLACES tool_input entirely (not merge).
#   Must copy all original fields and override only what's needed.

INPUT=$(cat)
TOOL_INPUT=$(echo "$INPUT" | jq '.tool_input' 2>/dev/null)
SEARCH_PATH=$(echo "$TOOL_INPUT" | jq -r '.path // empty' 2>/dev/null)

# Direct path check — block if targeting a secret file
if [ -n "$SEARCH_PATH" ]; then
  CHECK_OUTPUT=$(lrail policy check-file "$SEARCH_PATH" 2>&1)
  CHECK_EXIT=$?
  if [ "$CHECK_EXIT" -ne 0 ]; then
    echo "LLM Rail: $(echo "$CHECK_OUTPUT" | head -1). If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
    exit 2
  fi
fi

# Inject exclusion globs for secret_files (parsed from lrail.yml directly, no CLI exposure)
POLICY_FILE="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/lrail.yml"
SECRET_FILES=""
if [ -f "$POLICY_FILE" ]; then
  SECRET_FILES=$(yq -r '.env.secret_files[]? // empty' "$POLICY_FILE" 2>/dev/null \
    || awk '/^  secret_files:/,/^[^ ]/{if(/^    - /) print substr($0,7)}' "$POLICY_FILE" 2>/dev/null)
fi

if [ -n "$SECRET_FILES" ]; then
  # Build exclusion glob string
  EXCLUDE_GLOB=""
  while IFS= read -r sf; do
    [ -z "$sf" ] && continue
    if [ -n "$EXCLUDE_GLOB" ]; then
      EXCLUDE_GLOB="${EXCLUDE_GLOB},!${sf}"
    else
      EXCLUDE_GLOB="!${sf}"
    fi
  done <<< "$SECRET_FILES"

  # Merge with existing glob if present
  CURRENT_GLOB=$(echo "$TOOL_INPUT" | jq -r '.glob // empty' 2>/dev/null)
  if [ -n "$CURRENT_GLOB" ]; then
    FINAL_GLOB="${CURRENT_GLOB},${EXCLUDE_GLOB}"
  else
    FINAL_GLOB="${EXCLUDE_GLOB}"
  fi

  # Copy ALL original tool_input fields, override only glob
  UPDATED_INPUT=$(echo "$TOOL_INPUT" | jq --arg glob "$FINAL_GLOB" '. + {"glob": $glob}')

  jq -n --argjson updated "$UPDATED_INPUT" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "updatedInput": $updated
    }
  }'
  exit 0
fi

exit 0
