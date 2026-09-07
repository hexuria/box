#!/usr/bin/env bash
# Prove EnsureBox health, auth, create → exec → screenshot → destroy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "${APP}"

TOKEN="${ENSUREBOX_TOKEN:-dev-ensurebox-token}"
BASE="${ENSUREBOX_URL:-http://127.0.0.1:43142}"

echo "==> GET /api/v1/health"
curl -fsS "${BASE}/api/v1/health" | grep -q '"service":"ensurebox"'

echo "==> operator console is not a tools UI"
home_html="$(curl -fsS "${BASE}/")"
echo "${home_html}" | grep -q "Operator console"
if echo "${home_html}" | grep -q "Screenshot"; then
  echo "EnsureBox home must not include CUA tools" >&2
  exit 1
fi

echo "==> 401 without token"
code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/boxes")"
if [[ "${code}" != "401" ]]; then
  echo "expected 401, got ${code}" >&2
  exit 1
fi

if ! docker image inspect "${GROK_BOX_IMAGE:-grok-box:local}" >/dev/null 2>&1; then
  if sudo -n docker image inspect "${GROK_BOX_IMAGE:-grok-box:local}" >/dev/null 2>&1; then
    :
  else
    echo "skipping create: grok-box image not found. Build with: (cd ${ROOT} && docker compose build)" >&2
    echo "SMOKE OK (api only)"
    exit 0
  fi
fi

echo "==> POST /api/v1/boxes (create + wait ready)"
created="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke"}' \
  "${BASE}/api/v1/boxes")"
echo "${created}"
id="$(printf '%s' "${created}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
status="$(printf '%s' "${created}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
if [[ "${status}" != "ready" ]]; then
  echo "box was not ready: ${status}" >&2
  curl -s -H "Authorization: Bearer ${TOKEN}" -X DELETE "${BASE}/api/v1/boxes/${id}" || true
  exit 1
fi

cleanup() {
  curl -s -H "Authorization: Bearer ${TOKEN}" -X DELETE "${BASE}/api/v1/boxes/${id}" >/dev/null || true
}
trap cleanup EXIT

echo "==> operator box page has inventory, not Shell/CUA"
box_html="$(curl -fsS "${BASE}/boxes/${id}")"
echo "${box_html}" | grep -q "Volumes"
echo "${box_html}" | grep -q "VNC password"
if echo "${box_html}" | grep -q "Screenshot"; then
  echo "EnsureBox box page must not include CUA tools" >&2
  exit 1
fi
if echo "${box_html}" | grep -q ">Shell<"; then
  echo "EnsureBox box page must not include a Shell tab" >&2
  exit 1
fi

echo "==> POST exec echo ok"
out="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"command":["echo","ok"]}' \
  "${BASE}/api/v1/boxes/${id}/exec")"
echo "${out}"
echo "${out}" | grep -q '"exit_code":0'

echo "==> POST screenshot"
shot="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -X POST \
  "${BASE}/api/v1/boxes/${id}/cua/screenshot")"
printf '%s' "${shot}" | python3 -c '
import json,sys,base64
d=json.load(sys.stdin)
b=base64.b64decode(d["png_base64"])
assert b[:8]==b"\x89PNG\r\n\x1a\n"
assert d["width"]==1280 and d["height"]==800
print("png bytes", len(b))
'

echo
echo "SMOKE OK"
