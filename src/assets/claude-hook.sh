#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Claude Code hook handler — receives hook events and appends
# a JSONL record to the claude events log.
#
# Usage: /tmp/monitor/claude-hook.sh <EventName>
# Payload is read from stdin (JSON).
# Always exits 0 so it never blocks Claude Code.
# ──────────────────────────────────────────────────────────────

HOOK_EVENT="${1:-unknown}"
LOG_FILE="/tmp/monitor/claude-events.jsonl"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Read payload from stdin
PAYLOAD="$(cat)"

# Build JSONL record
if command -v jq &>/dev/null; then
  # Use jq for proper JSON construction
  printf '%s\n' "$PAYLOAD" | jq -c \
    --arg ts "$TIMESTAMP" \
    --arg ev "$HOOK_EVENT" \
    '{timestamp: $ts, hook_event: $ev, payload: .}' \
    >> "$LOG_FILE" 2>/dev/null
else
  # Fallback: simple printf (payload is already JSON)
  printf '{"timestamp":"%s","hook_event":"%s","payload":%s}\n' \
    "$TIMESTAMP" "$HOOK_EVENT" "${PAYLOAD:-null}" \
    >> "$LOG_FILE" 2>/dev/null
fi

exit 0
