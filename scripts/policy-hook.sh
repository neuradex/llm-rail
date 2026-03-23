#!/bin/bash
# LLM Rail PreToolUse hook for Bash commands.
# Reads tool input from stdin (JSON), extracts command, runs policy eval.
# When env mediation is active, forces all bash through `lrail bash`.

COMMAND=$(jq -r '.tool_input.command' 2>/dev/null)

if [ -z "$COMMAND" ] || [ "$COMMAND" = "null" ]; then
  exit 0
fi

# If env mediation is active, force all bash through lrail
if lrail policy has-env 2>/dev/null; then
  if [[ "$COMMAND" == lrail\ * ]] || [[ "$COMMAND" == lrail ]]; then
    # Going through proxy — proxy handles policy check internally
    exit 0
  else
    echo "Use 'lrail bash' for command execution when env mediation is active." >&2
    echo "Example: lrail bash '$COMMAND'" >&2
    exit 1
  fi
else
  lrail policy eval --command "$COMMAND"
fi
