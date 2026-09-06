#!/usr/bin/env bash
# Same checks as smoke.sh, against locally built binaries (no Docker).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

TOKEN="${BOX_TOKEN:-dev-box-token}"
export BOX_TOKEN="${TOKEN}"
export BOX_ID="${BOX_ID:-native-smoke}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-${ROOT}/workspace-data}"
export BOX_EXEC_BIND="${BOX_EXEC_BIND:-127.0.0.1:1337}"
export BOX_HOST_BIND="${BOX_HOST_BIND:-127.0.0.1:1340}"
export BOX_EXEC_URL="${BOX_EXEC_URL:-http://127.0.0.1:1337}"
export BOX_DESKTOP="${BOX_DESKTOP:-0}"
export BOX_DESKTOP_REQUIRED="${BOX_DESKTOP_REQUIRED:-0}"
export BOX_CHROME="${BOX_CHROME:-0}"
export BOX_CUA="${BOX_CUA:-0}"
export RUST_LOG="${RUST_LOG:-warn}"

mkdir -p "${WORKSPACE_ROOT}"

echo "==> cargo build"
cargo build -q -p box-exec -p box-host

./target/debug/box-exec &
EXEC_PID=$!
./target/debug/box-host &
HOST_PID=$!

cleanup() {
  kill -TERM "${EXEC_PID}" "${HOST_PID}" 2>/dev/null || true
  wait "${EXEC_PID}" 2>/dev/null || true
  wait "${HOST_PID}" 2>/dev/null || true
}
trap cleanup EXIT

ok=0
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:1337/v1/health >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1:1340/v1/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 0.25
done
if [[ "${ok}" != "1" ]]; then
  echo "native daemons never became healthy" >&2
  exit 1
fi

out="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"command":["echo","ok"]}' \
  http://127.0.0.1:1337/v1/exec)"
echo "${out}"
echo "${out}" | grep -q '"exit_code":0'
echo "${out}" | grep -q ok

code="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Content-Type: application/json" \
  -d '{"command":["true"]}' \
  http://127.0.0.1:1337/v1/exec)"
[[ "${code}" == "401" ]]

curl -fsS -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:1340/v1/info \
  | grep -q '"exec":true'

echo "NATIVE SMOKE OK"
