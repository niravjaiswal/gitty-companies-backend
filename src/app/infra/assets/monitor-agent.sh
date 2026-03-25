#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Monitor Agent — deployed into the sandbox by SandboxService.
# Runs three background jobs:
#   1. Filesystem watcher (inotifywait)
#   2. Shell history logger (via PROMPT_COMMAND in .bashrc)
#   3. Periodic file-content snapshots (rsync every 30s)
# ──────────────────────────────────────────────────────────────

MONITOR_DIR="/tmp/monitor"
SNAPSHOT_BASE="$MONITOR_DIR/snapshots"
FS_LOG="$MONITOR_DIR/fs-events.log"
CMD_LOG="$MONITOR_DIR/command-history.log"
PID_FILE="$MONITOR_DIR/agent.pid"
CLAUDE_LOG="$MONITOR_DIR/claude-events.jsonl"
TERMINAL_SESSIONS_DIR="$MONITOR_DIR/terminal-sessions"

# Track child PIDs for cleanup
CHILD_PIDS=()

cleanup() {
  for pid in "${CHILD_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  exit 0
}

trap cleanup SIGTERM SIGINT

# ── Setup ────────────────────────────────────────────────────
mkdir -p "$MONITOR_DIR" "$SNAPSHOT_BASE" "$TERMINAL_SESSIONS_DIR"
touch "$FS_LOG" "$CMD_LOG" "$CLAUDE_LOG"

# Write our own PID
echo $$ > "$PID_FILE"

# ── 1. Install inotify-tools & start filesystem watcher ─────
if ! command -v inotifywait &>/dev/null; then
  sudo dnf install -y inotify-tools 2>/dev/null \
    || sudo apt-get install -y inotify-tools 2>/dev/null \
    || true
fi

if command -v inotifywait &>/dev/null; then
  inotifywait -m -r /vercel/sandbox \
    --exclude '(/\.git/|/node_modules/|/\.cache/|/__pycache__/|\.swp$|\.swo$|/4913$)' \
    -e modify,create,delete,move \
    --timefmt '%Y-%m-%dT%H:%M:%S' \
    --format '%T %e %w%f' \
    >> "$FS_LOG" 2>/dev/null &
  CHILD_PIDS+=($!)
else
  echo "WARNING: inotifywait not available, filesystem monitoring disabled" >&2
fi

# ── 2. Shell history watcher ────────────────────────────────
# Append PROMPT_COMMAND to .bashrc so every interactive shell
# logs its commands with UTC timestamps.
HOME_BASHRC="${HOME:-/root}/.bashrc"
touch "$HOME_BASHRC"
if ! grep -q "CODEX_MONITOR_PROMPT_COMMAND" "$HOME_BASHRC" 2>/dev/null; then
cat >> "$HOME_BASHRC" << 'MONITOR_EOF'
# CODEX_MONITOR_PROMPT_COMMAND
export PROMPT_COMMAND='echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $(history 1 | sed "s/^[ ]*[0-9]*[ ]*//")" >> /tmp/monitor/command-history.log'

# Wrap interactive shells in script(1) to capture full terminal I/O
if [ -z "$SCRIPT_RUNNING" ] && command -v script &>/dev/null; then
  export SCRIPT_RUNNING=1
  exec script -q -f "/tmp/monitor/terminal-sessions/$(date -u +%Y%m%dT%H%M%SZ)-$$.typescript" \
    -T "/tmp/monitor/terminal-sessions/$(date -u +%Y%m%dT%H%M%SZ)-$$.timing"
fi
MONITOR_EOF
fi

# ── 3. Periodic file-content snapshots ──────────────────────
(
  while true; do
    SNAPSHOT_DIR="$SNAPSHOT_BASE/$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    mkdir -p "$SNAPSHOT_DIR"

    tar -cf - -C /vercel/sandbox \
      --exclude='.git' \
      --exclude='node_modules' \
      --exclude='.cache' \
      --exclude='__pycache__' \
      --exclude='.next' \
      --exclude='dist' \
      --exclude='build' \
      . 2>/dev/null | tar -xf - -C "$SNAPSHOT_DIR" 2>/dev/null || true

    find "$SNAPSHOT_DIR" -type f -not -name '.manifest' -printf '%P\n' > "$SNAPSHOT_DIR/.manifest" 2>/dev/null || true

    # Keep only the 20 most recent snapshots
    ls -dt "$SNAPSHOT_BASE"/*/ 2>/dev/null | tail -n +21 | xargs rm -rf 2>/dev/null || true

    sleep 30
  done
) &
CHILD_PIDS+=($!)

# ── Keep the agent alive ────────────────────────────────────
# Wait for all children; if any exits, the trap handles cleanup.
wait
