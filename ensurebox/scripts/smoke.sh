#!/usr/bin/env bash
# Prove EnsureBox health, auth, create → exec → screenshot → destroy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "${APP}"

TOKEN="${ENSUREBOX_TOKEN:-dev-ensurebox-token}"
BASE="${ENSUREBOX_URL:-http://127.0.0.1:43142}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}"' EXIT

echo "==> GET /api/v1/health"
curl -fsS "${BASE}/api/v1/health" | grep -q '"service":"ensurebox"'

echo "==> operator HTML without session is login, not docker buttons"
home_html="$(curl -fsS "${BASE}/")"
echo "${home_html}" | grep -q "Operator console"
echo "${home_html}" | grep -q "Sign in"
if echo "${home_html}" | grep -q "Create box"; then
  echo "unauthenticated operator HTML must not include Create box" >&2
  exit 1
fi
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

echo "==> session login"
curl -fsS -c "${COOKIE_JAR}" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"${TOKEN}\"}" \
  "${BASE}/api/session" | grep -q '"ok":true'

echo "==> operator console after login is inventory, not a tools UI"
authed_home="$(curl -fsS -b "${COOKIE_JAR}" "${BASE}/")"
echo "${authed_home}" | grep -q "Provision"
echo "${authed_home}" | grep -q "Create box"
if echo "${authed_home}" | grep -q "Screenshot"; then
  echo "EnsureBox home must not include CUA tools" >&2
  exit 1
fi

if ! docker image inspect "${GROK_BOX_IMAGE:-grok-box:local}" >/dev/null 2>&1; then
  echo "skipping create: grok-box image not found. Build with: (cd ${ROOT} && docker compose build)" >&2
  echo "SMOKE OK (api only)"
  exit 0
fi

echo "==> POST /api/v1/boxes (create + wait ready)"
created="$(curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke"}' \
  "${BASE}/api/v1/boxes")"
echo "${created}"
printf '%s' "${created}" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert "vncPassword" not in d, d
assert "endpoints" not in d, d
assert "ports" not in d, d
assert "boxToken" not in d, d
assert d.get("status")=="ready", d
print(d["id"])
' > /tmp/ensurebox-smoke-id
id="$(cat /tmp/ensurebox-smoke-id)"
rm -f /tmp/ensurebox-smoke-id

cleanup() {
  curl -s -H "Authorization: Bearer ${TOKEN}" -X DELETE "${BASE}/api/v1/boxes/${id}" >/dev/null || true
  rm -f "${COOKIE_JAR}"
}
trap cleanup EXIT

echo "==> operator box page has inventory, not Shell/CUA"
box_html="$(curl -fsS -b "${COOKIE_JAR}" "${BASE}/boxes/${id}")"
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

echo "==> unauthenticated box page has no lifecycle buttons"
unauth_box="$(curl -fsS "${BASE}/boxes/${id}")"
if echo "${unauth_box}" | grep -q "Destroy"; then
  echo "unauthenticated operator HTML must not include Destroy" >&2
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

echo "==> files mkdir/put/delete"
smoke_dir="smoke-dir-$$"
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"${smoke_dir}\",\"parents\":true}" \
  "${BASE}/api/v1/boxes/${id}/files/mkdir" | grep -q '"created":true'
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -X PUT \
  -d "{\"path\":\"${smoke_dir}/a.txt\",\"content\":\"hi\"}" \
  "${BASE}/api/v1/boxes/${id}/files" | grep -q '"bytes_written"'
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -X DELETE \
  "${BASE}/api/v1/boxes/${id}/files?path=${smoke_dir}/a.txt" | grep -q '"deleted":true'

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

echo "==> CUA move/double-click/drag"
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"x":80,"y":80}' \
  "${BASE}/api/v1/boxes/${id}/cua/move" | grep -q '"ok":true'
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"x":80,"y":80}' \
  "${BASE}/api/v1/boxes/${id}/cua/double-click" | grep -q '"ok":true'
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"x1":80,"y1":80,"x2":120,"y2":120}' \
  "${BASE}/api/v1/boxes/${id}/cua/drag" | grep -q '"ok":true'

echo
echo "SMOKE OK"
