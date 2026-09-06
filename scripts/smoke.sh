#!/usr/bin/env bash
# Build the image, start the box, and prove health + authenticated exec.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

TOKEN="${BOX_TOKEN:-dev-box-token}"
export BOX_TOKEN="${TOKEN}"
EXEC_URL="${EXEC_URL:-http://127.0.0.1:1337}"
HOST_URL="${HOST_URL:-http://127.0.0.1:1340}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for this smoke test" >&2
  echo "install Docker, or run: scripts/smoke-native.sh" >&2
  exit 1
fi

COMPOSE=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    echo "docker compose is required" >&2
    exit 1
  fi
fi

mkdir -p workspace-data chrome-profile

echo "==> building and starting grok-box"
"${COMPOSE[@]}" up --build -d

cleanup() {
  "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> waiting for health"
ok=0
for _ in $(seq 1 90); do
  if curl -fsS "${EXEC_URL}/v1/health" >/dev/null 2>&1 \
    && curl -fsS "${HOST_URL}/v1/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "${ok}" != "1" ]]; then
  echo "daemons never became healthy" >&2
  "${COMPOSE[@]}" logs || true
  exit 1
fi

echo "==> GET /v1/health (exec)"
curl -fsS "${EXEC_URL}/v1/health" | grep -q '"status":"ok"'

echo "==> POST /v1/exec echo ok"
out="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"command":["echo","ok"]}' \
  "${EXEC_URL}/v1/exec")"
echo "${out}"
echo "${out}" | grep -q '"exit_code":0'
echo "${out}" | grep -q ok

echo "==> files put/get"
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -X PUT \
  -d '{"path":"smoke.txt","content":"hello"}' \
  "${EXEC_URL}/v1/files" >/dev/null
got="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  "${EXEC_URL}/v1/files?path=smoke.txt")"
echo "${got}" | grep -q hello

echo "==> auth reject"
code="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Content-Type: application/json" \
  -d '{"command":["echo","x"]}' \
  "${EXEC_URL}/v1/exec")"
if [[ "${code}" != "401" ]]; then
  echo "expected 401 without token, got ${code}" >&2
  exit 1
fi

echo "==> GET /v1/info (host)"
info="$(curl -fsS -H "Authorization: Bearer ${TOKEN}" "${HOST_URL}/v1/info")"
echo "${info}" | grep -q '"box_id"'
echo "${info}" | grep -q '"exec":true'

echo "==> GET /v1/ready (host)"
curl -fsS "${HOST_URL}/v1/ready" | grep -q '"exec_ready":true'

echo
echo "SMOKE OK"
