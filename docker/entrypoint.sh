#!/bin/bash
set -euo pipefail

if [[ -z "${BOX_TOKEN:-}" ]]; then
  echo "BOX_TOKEN must be set" >&2
  exit 1
fi

export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
mkdir -p "${WORKSPACE_ROOT}" "${HOME:-/home/box}/chrome-profile"

echo "grok-box starting box_id=${BOX_ID:-grok-box} workspace=${WORKSPACE_ROOT}"

box-exec &
EXEC_PID=$!

box-host &
HOST_PID=$!

shutdown() {
  echo "grok-box shutting down"
  kill -TERM "${EXEC_PID}" "${HOST_PID}" 2>/dev/null || true
  wait "${EXEC_PID}" 2>/dev/null || true
  wait "${HOST_PID}" 2>/dev/null || true
}

trap shutdown SIGINT SIGTERM

while kill -0 "${EXEC_PID}" 2>/dev/null && kill -0 "${HOST_PID}" 2>/dev/null; do
  sleep 1
done

echo "a daemon exited; stopping the sibling process" >&2
shutdown
exit 1
