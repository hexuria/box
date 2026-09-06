#!/usr/bin/env bash
# Run box-exec + box-host on the host (no container).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

export BOX_TOKEN="${BOX_TOKEN:-dev-box-token}"
export BOX_ID="${BOX_ID:-local-dev}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-${ROOT}/workspace-data}"
export BOX_EXEC_BIND="${BOX_EXEC_BIND:-0.0.0.0:1337}"
export BOX_HOST_BIND="${BOX_HOST_BIND:-0.0.0.0:1340}"
export BOX_EXEC_URL="${BOX_EXEC_URL:-http://127.0.0.1:1337}"
export RUST_LOG="${RUST_LOG:-info}"

mkdir -p "${WORKSPACE_ROOT}"
echo "BOX_TOKEN=${BOX_TOKEN}  workspace=${WORKSPACE_ROOT}"
echo "exec  ${BOX_EXEC_BIND}"
echo "host  ${BOX_HOST_BIND}"

cargo build -p box-exec -p box-host

./target/debug/box-exec &
EXEC_PID=$!
./target/debug/box-host &
HOST_PID=$!

shutdown() {
  kill -TERM "${EXEC_PID}" "${HOST_PID}" 2>/dev/null || true
  wait "${EXEC_PID}" 2>/dev/null || true
  wait "${HOST_PID}" 2>/dev/null || true
}
trap shutdown INT TERM
wait -n "${EXEC_PID}" "${HOST_PID}" || true
shutdown
