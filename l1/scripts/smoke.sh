#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${L1_URL:-http://127.0.0.1:43141}"
L1_TOKEN_VALUE="${L1_TOKEN:-dev-l1-token}"

echo "== L1 source must not talk to the guest or leak viewer secrets =="
if grep -RInE '\<BOX_TOKEN\>|127\.0\.0\.1:1337|127\.0\.0\.1:1340|BOX_EXEC_URL|box-exec|box-host|vncPassword|:6080|Open live desktop|Live desktop password' "$ROOT/src"; then
  echo "L1 source must not call the guest, hold BOX_TOKEN, or show a VNC password / raw 6080 UI" >&2
  exit 1
fi

echo "== L1 health (EnsureBox must be up) =="
payload="$(curl -fsS --max-time 10 "$BASE/api/health")"
echo "$payload"
printf '%s\n' "$payload" | python3 -c '
import json, sys
body = json.load(sys.stdin)
assert body.get("service") == "l1", body
assert body.get("status") == "ok", body
eb = body.get("ensurebox") or {}
assert eb.get("reachable") is True, body
assert eb.get("authorized") is True, body
print("ok")
'

echo "== L1 home without session is login, not a workspace console =="
html="$(curl -fsS --max-time 15 "$BASE/")"
echo "$html" | grep -q "Sign in"
if echo "$html" | grep -q "New workspace"; then
  echo "unauthenticated L1 home must not include New workspace" >&2
  exit 1
fi
if echo "$html" | grep -q "Connected to EnsureBox"; then
  echo "L1 home must not show a hero EnsureBox connection banner" >&2
  exit 1
fi

echo "== L1 session login =="
COOKIE_JAR="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}"' EXIT
curl -fsS -c "${COOKIE_JAR}" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"${L1_TOKEN_VALUE}\"}" \
  "${BASE}/api/session" | grep -q '"ok":true'

echo "== L1 home is a workspace client, not an ops console =="
html="$(curl -fsS --max-time 15 -b "${COOKIE_JAR}" "$BASE/")"
echo "$html" | grep -q "Workspaces"
echo "$html" | grep -q "New workspace"
if echo "$html" | grep -q "Connected to EnsureBox"; then
  echo "L1 home must not show a hero EnsureBox connection banner" >&2
  exit 1
fi
if echo "$html" | grep -E 'exec :[0-9]|host :[0-9]|viewer :[0-9]'; then
  echo "L1 home must not advertise guest host ports" >&2
  exit 1
fi
if echo "$html" | grep -q "Open live desktop"; then
  echo "L1 must not link a live desktop on guest 6080" >&2
  exit 1
fi
echo "ok"
