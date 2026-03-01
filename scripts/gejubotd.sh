#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/gejubot.pid"
LOG_FILE="$RUNTIME_DIR/gejubot.log"
ENV_FILE="$ROOT_DIR/.env"
SERVER_FILE="$ROOT_DIR/app/server.py"
PYTHON_BIN="${PYTHON_BIN:-python3}"

mkdir -p "$RUNTIME_DIR"

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

require_config() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing $ENV_FILE. Copy .env.example to .env and fill paths first."
    exit 1
  fi
  : "${KATAGO_BINARY:?KATAGO_BINARY is required in .env}"
  : "${KATAGO_MODEL:?KATAGO_MODEL is required in .env}"
  : "${KATAGO_CONFIG:?KATAGO_CONFIG is required in .env}"
}

start() {
  load_env
  require_config
  if is_running; then
    echo "gejubot backend is already running (pid $(cat "$PID_FILE"))."
    exit 0
  fi
  nohup "$PYTHON_BIN" "$SERVER_FILE" >>"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"
  sleep 1
  if is_running; then
    echo "started gejubot backend (pid $pid)."
    echo "log: $LOG_FILE"
    exit 0
  fi
  echo "failed to start gejubot backend, check log: $LOG_FILE"
  exit 1
}

run_foreground() {
  load_env
  require_config
  exec "$PYTHON_BIN" "$SERVER_FILE"
}

stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "gejubot backend is not running."
    exit 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" || true
  fi
  rm -f "$PID_FILE"
  echo "stopped gejubot backend."
}

status() {
  if is_running; then
    echo "running (pid $(cat "$PID_FILE"))."
  else
    echo "not running."
    exit 1
  fi
}

show_logs() {
  touch "$LOG_FILE"
  tail -n 100 -f "$LOG_FILE"
}

usage() {
  echo "Usage: $0 {start|stop|restart|status|run|logs}"
}

cmd="${1:-}"
case "$cmd" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop || true
    start
    ;;
  status)
    status
    ;;
  run)
    run_foreground
    ;;
  logs)
    show_logs
    ;;
  *)
    usage
    exit 1
    ;;
esac
