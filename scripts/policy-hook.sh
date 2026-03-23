#!/bin/bash
# LLM Rail PreToolUse hook for Bash commands.
# Reads tool input from stdin (JSON), extracts command, runs policy eval.
# When env mediation is active, rewrites commands to go through `lrail bash`.
#
# Claude Code hook protocol:
#   exit 0 → allow (stdout JSON can modify input via updatedInput)
#   exit 2 + stderr → blocking error (tool blocked)
#   exit 1 → non-blocking error (ignored, tool proceeds)

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command' 2>/dev/null)

if [ -z "$COMMAND" ] || [ "$COMMAND" = "null" ]; then
  exit 0
fi

# If env mediation is active, rewrite command to go through lrail bash
if lrail policy has-env 2>/dev/null; then
  if [[ "$COMMAND" == lrail\ * ]] || [[ "$COMMAND" == lrail ]]; then
    exit 0
  else
    mkdir -p .llm-rail
    ESCAPED_CMD=$(printf '%s' "$COMMAND" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
    echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"command\":\"$ESCAPED_CMD\",\"cwd\":\"$(pwd)\",\"source\":\"hook\",\"rewritten\":true}" >> .llm-rail/command.jsonl

    # Escape single quotes for wrapping
    SAFE_CMD=$(printf '%s' "$COMMAND" | sed "s/'/'\\\\''/g")
    WRAPPED="lrail bash '${SAFE_CMD}'"

    jq -n --arg cmd "$WRAPPED" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          command: $cmd
        }
      }
    }'
    exit 0
  fi
fi

# Policy eval
EVAL_OUTPUT=$(lrail policy eval --command "$COMMAND" 2>&1)
EVAL_EXIT=$?

if [ "$EVAL_EXIT" -ne 0 ]; then
  echo "LLM Rail policy denied: $(echo "$EVAL_OUTPUT" | head -1). If this is a misconfiguration, ask the user to edit lrail.yml directly." >&2
  exit 2
fi

exit 0
