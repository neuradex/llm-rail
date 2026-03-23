#!/bin/bash
# LLM Rail PreToolUse hook for Bash commands.
# Reads tool input from stdin (JSON), extracts command, runs policy eval.
# When env mediation is active, forces all bash through `lrail bash`.
#
# Claude Code hook protocol:
#   exit 0 → allow (tool proceeds)
#   exit 2 + stderr → blocking error (tool blocked)
#   exit 1 → non-blocking error (ignored, tool proceeds)

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command' 2>/dev/null)

if [ -z "$COMMAND" ] || [ "$COMMAND" = "null" ]; then
  exit 0
fi

# If env mediation is active, force all bash through lrail
if lrail policy has-env 2>/dev/null; then
  if [[ "$COMMAND" == lrail\ * ]] || [[ "$COMMAND" == lrail ]]; then
    exit 0
  else
    mkdir -p .llm-rail
    ESCAPED_CMD=$(printf '%s' "$COMMAND" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
    echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"command\":\"$ESCAPED_CMD\",\"cwd\":\"$(pwd)\",\"source\":\"hook\",\"denied\":true,\"reason\":\"env-mediation\"}" >> .llm-rail/command.jsonl
    echo "LLM Rail: env mediation is active. Run instead: lrail bash '$COMMAND'" >&2
    exit 2
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
