#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${L1_URL:-http://127.0.0.1:43141}"

echo "== L1 source must not talk to the guest =="
if grep -RInE 'process\.env\.BOX_TOKEN|127\.0\.0\.1:1337|127\.0\.0\.1:1340|BOX_EXEC_URL' "$ROOT/src"; then
  echo "L1 source must not call the guest or hold BOX_TOKEN" >&2
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

echo "== L1 home page =="
html="$(curl -fsS --max-time 15 "$BASE/")"
echo "$html" | grep -q "Layer 1 client"
echo "$html" | grep -q "Talks only to EnsureBox"
echo "ok"
