#!/usr/bin/env bash
set -euo pipefail

# scripts/riff.sh — detached dev launcher with WebKit workaround
# Called by bin/riff; can also be run directly as ./scripts/riff.sh
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && /bin/pwd)"
cd "$repo_root"

rebuild=0
forward_args=()
for arg in "$@"; do
  case "$arg" in
    --rebuild|-r|--build) rebuild=1 ;;
    --help|-h)
      echo "Usage: riff [--rebuild|-r] [pattern/prompt args...]"
      echo "  riff              launch detached (no rebuild)"
      echo "  riff --rebuild    rebuild dist then launch detached"
      echo "  always detached, logs to /tmp/riff-electrobun.log"
      exit 0
      ;;
    *) forward_args+=("$arg") ;;
  esac
done

if [[ $rebuild -eq 1 ]]; then
  echo "[riff] rebuilding dist..."
  pnpm run build:web
fi

unset RIFF_STARTUP_ARGC
for i in $(seq 0 64 2>/dev/null | head -20); do unset "RIFF_STARTUP_ARG_$i" 2>/dev/null || true; done
arg_index=0
for arg in "${forward_args[@]}"; do
  export "RIFF_STARTUP_ARG_${arg_index}=${arg}"
  arg_index=$((arg_index + 1))
done
export RIFF_STARTUP_ARGC="${arg_index}"

for p in $(pgrep -f "build/dev-linux-x64/riff-dev/bin/launcher" 2>/dev/null || true); do kill "$p" 2>/dev/null || true; done
for p in $(pgrep -f "Resources/main.js" 2>/dev/null || true); do
  if ps -o cmd= -p "$p" 2>/dev/null | grep -q "riff-dev"; then kill "$p" 2>/dev/null || true; fi
done
sleep 1

LOG=/tmp/riff-electrobun.log
: > "$LOG"
echo "[riff] launching detached... log: $LOG"
WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  setsid -f ./node_modules/.bin/electrobun dev </dev/null >>"$LOG" 2>&1

for i in 1 2 3 4 5 6; do
  sleep 1
  if grep -q "Riff started!" "$LOG" 2>/dev/null; then break; fi
done

PORT=$(grep -oP 'Serving mainview.*127\.0\.0\.1:\K[0-9]+' "$LOG" 2>/dev/null | head -1 || true)
if grep -q "GTK EVENT LOOP STARTED" "$LOG" 2>/dev/null && grep -q "Riff started!" "$LOG" 2>/dev/null; then
  echo "[riff] ✓ running — GTK loop started, Riff started!"
  [[ -n "$PORT" ]] && echo "[riff]   mainview: http://127.0.0.1:$PORT/ (curl --noproxy \"*\" http://127.0.0.1:$PORT/)"
  echo "[riff]   RPC: http://localhost:50000/"
  echo "[riff]   log: tail -f $LOG"
else
  echo "[riff] ! launch may have failed — check log:"
  tail -40 "$LOG" 2>/dev/null || true
  exit 1
fi
