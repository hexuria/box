#!/usr/bin/env bash
# Materialise ./secrets/* from BOX_TOKEN / BOX_VNC_PASSWORD (or .env) so Compose
# can mount them instead of putting the values in the container environment.
#
# Files are 0644 inside a 0700 directory on purpose: the directory is what keeps
# other host users out, while the file mode is what the container's uid 1000
# needs to read the bind mount regardless of which uid created it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

if [[ -z "${BOX_TOKEN:-}" ]]; then
  echo "BOX_TOKEN is not set. Export it or add it to .env (the value is not printed)." >&2
  exit 1
fi
if [[ -z "${BOX_VNC_PASSWORD:-}" ]]; then
  echo "BOX_VNC_PASSWORD is not set (x11vnc uses the first 8 characters)." >&2
  exit 1
fi

mkdir -p "${ROOT}/secrets"
chmod 700 "${ROOT}/secrets"

write_secret() {
  local path="$1" value="$2"
  (
    umask 077
    printf '%s' "${value}" >"${path}"
  )
  chmod 644 "${path}"
}

write_secret "${ROOT}/secrets/box_token" "${BOX_TOKEN}"
write_secret "${ROOT}/secrets/box_vnc_password" "${BOX_VNC_PASSWORD}"

echo "wrote secrets/box_token and secrets/box_vnc_password (values not printed)"
