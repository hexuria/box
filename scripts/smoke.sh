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
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    COMPOSE=(sudo -n docker compose)
  else
    echo "cannot talk to the Docker daemon (try adding this user to the docker group)" >&2
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

echo "==> waiting for health + ready"
ok=0
for _ in $(seq 1 90); do
  if curl -fsS "${EXEC_URL}/v1/health" >/dev/null 2>&1 \
    && curl -fsS "${HOST_URL}/v1/health" >/dev/null 2>&1 \
    && curl -fsS "${HOST_URL}/v1/ready" >/dev/null 2>&1; then
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
echo "${info}"
echo "${info}" | grep -q '"box_id"'
echo "${info}" | grep -q '"exec":true'
echo "${info}" | grep -q '"files":true'
echo "${info}" | grep -q '"desktop":true'
echo "${info}" | grep -q '"chrome":true'
echo "${info}" | grep -q '"cua":true'

echo "==> GET /v1/desktop (host)"
desk="$(curl -fsS -H "Authorization: Bearer ${TOKEN}" "${HOST_URL}/v1/desktop")"
echo "${desk}"
echo "${desk}" | grep -q '"available":true'
echo "${desk}" | grep -q '"display":":1"'
echo "${desk}" | grep -q '"port":6080'

echo "==> GET /v1/chrome (host)"
chrome="$(curl -fsS -H "Authorization: Bearer ${TOKEN}" "${HOST_URL}/v1/chrome")"
echo "${chrome}"
echo "${chrome}" | grep -q '"enabled":true'
echo "${chrome}" | grep -q '"cdp":"127.0.0.1:9222"'

echo "==> GET /v1/ready (host)"
ready="$(curl -fsS "${HOST_URL}/v1/ready")"
echo "${ready}"
echo "${ready}" | grep -q '"exec_ready":true'
echo "${ready}" | grep -q '"desktop_ready":true'

echo "==> noVNC viewer"
novnc="$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:6080/vnc.html)"
if [[ "${novnc}" != "200" ]]; then
  echo "expected noVNC /vnc.html 200, got ${novnc}" >&2
  "${COMPOSE[@]}" logs || true
  exit 1
fi

echo "==> POST /v1/cua/screenshot"
shot="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -X POST \
  "${EXEC_URL}/v1/cua/screenshot")"
if ! printf '%s' "${shot}" | grep -q '"mime":"image/png"'; then
  echo "screenshot missing image/png mime" >&2
  echo "${shot:0:400}" >&2
  exit 1
fi
if command -v python3 >/dev/null 2>&1; then
  printf '%s' "${shot}" | python3 -c '
import json, sys, base64
d = json.load(sys.stdin)
b = base64.b64decode(d["png_base64"])
assert b[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
assert len(b) > 64, "screenshot too small"
assert d["width"] == 1280 and d["height"] == 800
print("png bytes", len(b))
'
else
  b64="$(printf '%s' "${shot}" | sed -n 's/.*"png_base64":"\([^"]*\)".*/\1/p')"
  if [[ -z "${b64}" || ${#b64} -lt 32 ]]; then
    echo "empty png_base64" >&2
    exit 1
  fi
  printf '%s' "${b64}" | base64 -d | head -c 8 | grep -q $'\x89PNG' || {
    echo "decoded screenshot was not a PNG" >&2
    exit 1
  }
fi

echo "==> POST /v1/cua/click (optional)"
click="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"x":640,"y":400,"button":1}' \
  "${EXEC_URL}/v1/cua/click")"
echo "${click}"
echo "${click}" | grep -q '"ok":true'

echo "==> BOX_DESKTOP=0 still serves exec+host"
"${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
BOX_DESKTOP=0 BOX_DESKTOP_REQUIRED=0 "${COMPOSE[@]}" up -d
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "${EXEC_URL}/v1/health" >/dev/null 2>&1 \
    && curl -fsS "${HOST_URL}/v1/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "${ok}" != "1" ]]; then
  echo "BOX_DESKTOP=0 daemons never became healthy" >&2
  "${COMPOSE[@]}" logs || true
  exit 1
fi
off_info="$(curl -fsS -H "Authorization: Bearer ${TOKEN}" "${HOST_URL}/v1/info")"
echo "${off_info}" | grep -q '"desktop":false'
echo "${off_info}" | grep -q '"chrome":false'
echo "${off_info}" | grep -q '"cua":false'
curl -fsS "${HOST_URL}/v1/ready" | grep -q '"exec_ready":true'
off_exec="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"command":["echo","ok"]}' \
  "${EXEC_URL}/v1/exec")"
echo "${off_exec}" | grep -q '"exit_code":0'

echo
echo "SMOKE OK"
