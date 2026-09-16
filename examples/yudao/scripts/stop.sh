#!/usr/bin/env bash
# 停止演示环境（后端 :8080 + 前端 :5173）
set -e
cd "$(dirname "$0")/.."
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

free_port() {
  local port="$1"
  if command -v netstat >/dev/null 2>&1; then
    local pids
    pids="$(netstat -ano 2>/dev/null | grep -E "[:.]${port}[[:space:]].*LISTENING" | awk '{print $NF}' | sort -u)"
    for pid in $pids; do [ -n "$pid" ] && taskkill //F //PID "$pid" >/dev/null 2>&1 || true; done
  fi
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti ":${port}" 2>/dev/null || true)"
    for pid in $pids; do kill -9 "$pid" >/dev/null 2>&1 || true; done
  fi
}

free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"
echo "已停止：后端 :${BACKEND_PORT} / 前端 :${FRONTEND_PORT}"
