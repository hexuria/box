#!/bin/bash
set -euo pipefail

# Every secret can arrive two ways: as a value (BOX_TOKEN) or as a path to a
# file holding it (BOX_TOKEN_FILE). The file form is the one to use. A value
# handed to the container through the environment is copied into the
# environment block of pid 1 at execve and stays readable there —
# /proc/1/environ — for every process in the box, for the life of the box.
# `unset` below does not undo that; it only changes what getenv sees.
read_secret() {
  local name="$1"
  local file_var="${name}_FILE"
  local path="${!file_var:-}"
  if [[ -n "${path}" ]]; then
    if [[ ! -r "${path}" ]]; then
      echo "${file_var} is set to ${path} but that file is not readable" >&2
      exit 1
    fi
    tr -d '\r\n' < "${path}"
    return 0
  fi
  printf '%s' "${!name:-}"
}

BOX_TOKEN_VALUE="$(read_secret BOX_TOKEN)"
if [[ -z "${BOX_TOKEN_VALUE}" ]]; then
  echo "BOX_TOKEN or BOX_TOKEN_FILE must be set" >&2
  exit 1
fi
BOX_HOST_TOKEN_VALUE="$(read_secret BOX_HOST_TOKEN)"
if [[ -z "${BOX_HOST_TOKEN_VALUE}" ]]; then
  BOX_HOST_TOKEN_VALUE="${BOX_TOKEN_VALUE}"
fi
BOX_VNC_PASSWORD_VALUE="$(read_secret BOX_VNC_PASSWORD)"
# Shell variables are not in the environ block, so these copies are not served
# by /proc/<pid>/environ the way the exported forms are.
unset BOX_TOKEN BOX_HOST_TOKEN BOX_VNC_PASSWORD || true

export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
export BOX_DESKTOP="${BOX_DESKTOP:-1}"
export BOX_DISPLAY="${BOX_DISPLAY:-:1}"
export BOX_DISPLAY_GEOM="${BOX_DISPLAY_GEOM:-1280x800x24}"
export BOX_VNC_BIND="${BOX_VNC_BIND:-127.0.0.1:5900}"
export BOX_NOVNC_PORT="${BOX_NOVNC_PORT:-6080}"
export BOX_NOVNC_WEB="${BOX_NOVNC_WEB:-/usr/share/novnc}"
export BOX_CHROME="${BOX_CHROME:-1}"
export BOX_CHROME_PROFILE="${BOX_CHROME_PROFILE:-${HOME:-/home/box}/chrome-profile}"
export BOX_CDP_PORT="${BOX_CDP_PORT:-9222}"
export BOX_CUA="${BOX_CUA:-1}"
# Listen on all interfaces *inside* the container netns so Compose port-map
# works. Host publish is 127.0.0.1 (see docker-compose.yml).
export BOX_EXEC_BIND="${BOX_EXEC_BIND:-0.0.0.0:1337}"
export BOX_HOST_BIND="${BOX_HOST_BIND:-0.0.0.0:1340}"

mkdir -p "${WORKSPACE_ROOT}" "${BOX_CHROME_PROFILE}"

flag_on() {
  local v
  v="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${v}" != "0" && "${v}" != "false" && "${v}" != "off" && "${v}" != "no" ]]
}

display_num() {
  echo "${BOX_DISPLAY}" | tr -d ':' | cut -d. -f1
}

vnc_port() {
  echo "${BOX_VNC_BIND##*:}"
}

geom_wh() {
  # BOX_DISPLAY_GEOM=WIDTHxHEIGHTxDEPTH → WIDTH HEIGHT
  local g w rest h
  g="${BOX_DISPLAY_GEOM}"
  w="${g%%x*}"
  rest="${g#*x}"
  h="${rest%%x*}"
  echo "${w} ${h}"
}

PIDS=()

record() {
  PIDS+=("$1")
}

shutdown() {
  echo "grok-box shutting down"
  local pid
  rm -rf "${SECRET_DIR:-}" 2>/dev/null || true
  if [[ -f /tmp/box-chrome.pid ]]; then
    kill -TERM "$(cat /tmp/box-chrome.pid)" 2>/dev/null || true
  fi
  for pid in "${PIDS[@]}"; do
    kill -TERM "${pid}" 2>/dev/null || true
  done
  for pid in "${PIDS[@]}"; do
    wait "${pid}" 2>/dev/null || true
  done
}

trap shutdown SIGINT SIGTERM

start_desktop() {
  local dnum xvfb_screen vnc_pass passfile
  dnum="$(display_num)"
  xvfb_screen="${BOX_DISPLAY_GEOM}"

  if [[ -z "${BOX_VNC_PASSWORD_VALUE}" ]]; then
    echo "BOX_VNC_PASSWORD must be set when BOX_DESKTOP=1 (independent of BOX_TOKEN; x11vnc uses the first 8 characters)" >&2
    exit 1
  fi

  echo "starting Xvfb ${BOX_DISPLAY} ${xvfb_screen}"
  # XTEST is required for in-process CUA. DAMAGE lets x11vnc push dirty rects.
  Xvfb "${BOX_DISPLAY}" -screen 0 "${xvfb_screen}" -ac +extension GLX +extension XTEST +extension DAMAGE +render -noreset &
  record $!

  local n=0
  while [[ ${n} -lt 50 ]]; do
    if [[ -S "/tmp/.X11-unix/X${dnum}" ]]; then
      break
    fi
    sleep 0.1
    n=$((n + 1))
  done
  if [[ ! -S "/tmp/.X11-unix/X${dnum}" ]]; then
    echo "Xvfb did not create /tmp/.X11-unix/X${dnum}" >&2
    exit 1
  fi

  export DISPLAY="${BOX_DISPLAY}"

  echo "starting xfce4 on ${DISPLAY}"
  # xfce4-session brings up xfwm4, xfdesktop and the panel; they talk over
  # dbus. dbus-launch stays alive for the session, so the watchdog below
  # treats the desktop going away like any other required process.
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-box}"
  export XDG_CONFIG_HOME="${HOME:-/home/box}/.config"
  mkdir -p "${XDG_RUNTIME_DIR}"
  chmod 700 "${XDG_RUNTIME_DIR}"
  dbus-launch --exit-with-session xfce4-session >/tmp/xfce4-session.log 2>&1 &
  record $!

  mkdir -p "${HOME:-/home/box}/.vnc"
  passfile="${HOME:-/home/box}/.vnc/passwd"
  vnc_pass="${BOX_VNC_PASSWORD_VALUE:0:8}"
  x11vnc -storepasswd "${vnc_pass}" "${passfile}" >/dev/null
  chmod 600 "${passfile}"
  vnc_pass=""

  echo "starting x11vnc on ${BOX_VNC_BIND} (localhost only)"
  # LAN flags: XDAMAGE (not polling the whole 1280×800), short wait/defer.
  # Keys: -xkb maps the viewer's keysyms through XKEYBOARD (Mac and non-US
  # layouts otherwise lose keys); -clear_mods/-clear_keys start clean; and
  # every client that arrives or leaves runs box-release-keys, so a ⌘ held
  # when a window closed cannot stay held in this X server.
  x11vnc \
    -display "${BOX_DISPLAY}" \
    -rfbport "$(vnc_port)" \
    -localhost \
    -rfbauth "${passfile}" \
    -forever \
    -shared \
    -xdamage \
    -nowireframe \
    -speeds lan \
    -wait 10 \
    -defer 5 \
    -xkb \
    -clear_mods \
    -clear_keys \
    -afteraccept /usr/local/bin/box-release-keys \
    -gone /usr/local/bin/box-release-keys \
    >/tmp/x11vnc.log 2>&1 &
  record $!

  if [[ ! -d "${BOX_NOVNC_WEB}" ]]; then
    echo "noVNC web root missing: ${BOX_NOVNC_WEB}" >&2
    exit 1
  fi

  # 0.0.0.0 *inside* the container so Docker port-map to the veth IP works.
  # Host publish is 127.0.0.1:6080. 6080 is not Bearer-authenticated.
  echo "starting noVNC/websockify on 0.0.0.0:${BOX_NOVNC_PORT} (host publish should be loopback)"
  websockify-nodelay --web="${BOX_NOVNC_WEB}" "0.0.0.0:${BOX_NOVNC_PORT}" "${BOX_VNC_BIND}" \
    >/tmp/websockify.log 2>&1 &
  record $!
}

start_chrome() {
  local bin="" candidate w h
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      bin="${candidate}"
      break
    fi
  done
  if [[ -z "${bin}" ]]; then
    echo "chromium not found; capabilities.chrome will stay false" >&2
    return 0
  fi

  mkdir -p "${BOX_CHROME_PROFILE}"
  if [[ ! -w "${BOX_CHROME_PROFILE}" ]]; then
    echo "chrome profile ${BOX_CHROME_PROFILE} is not writable; using /tmp/box-chrome-profile" >&2
    export BOX_CHROME_PROFILE="/tmp/box-chrome-profile"
    mkdir -p "${BOX_CHROME_PROFILE}"
  fi
  read -r w h < <(geom_wh)
  export DISPLAY="${BOX_DISPLAY}"

  echo "starting ${bin} on ${DISPLAY} profile=${BOX_CHROME_PROFILE} cdp=127.0.0.1:${BOX_CDP_PORT}"
  # uid 1000 cannot use Chrome's setuid sandbox in this image. --no-sandbox stays.
  # Do not pass --disable-setuid-sandbox: Chromium names that flag on the yellow
  # infobar. managed policy + --test-type hide the remaining --no-sandbox warning
  # so CUA screenshots are a usable desktop, not a banner.
  # Closing/crashing the browser must not take the box down — restart it.
  (
    while true; do
      "${bin}" \
        --user-data-dir="${BOX_CHROME_PROFILE}" \
        --no-first-run \
        --no-default-browser-check \
        --disable-dev-shm-usage \
        --disable-gpu \
        --disable-software-rasterizer \
        --no-sandbox \
        --test-type \
        --hide-crash-restore-bubble \
        --disable-session-crashed-bubble \
        --disable-features=Translate \
        --window-size="${w},${h}" \
        --window-position=0,0 \
        --remote-debugging-address=127.0.0.1 \
        --remote-debugging-port="${BOX_CDP_PORT}" \
        about:blank \
        >/tmp/box-chrome.log 2>&1 &
      echo $! > /tmp/box-chrome.pid
      wait $! || true
      echo "chromium exited; restarting in 2s" >&2
      sleep 2
    done
  ) &
}

echo "grok-box starting box_id=${BOX_ID:-grok-box} workspace=${WORKSPACE_ROOT} desktop=${BOX_DESKTOP} chrome=${BOX_CHROME} cua=${BOX_CUA}"

if flag_on "${BOX_DESKTOP}"; then
  start_desktop
  if flag_on "${BOX_CHROME}"; then
    start_chrome
  fi
fi

# Hand the daemons a path, never a value. `env BOX_TOKEN=... box-exec` puts the
# token in that daemon's /proc/<pid>/environ at execve, where it stays for the
# life of the process and where the daemon cannot remove it. Each daemon reads
# its own copy and unlinks it, so the file exists for the few milliseconds
# between this write and daemon startup.
SECRET_DIR="$(mktemp -d /tmp/box-secrets.XXXXXX)"
chmod 700 "${SECRET_DIR}"

stage_secret() {
  local path="$1" value="$2"
  (
    umask 077
    printf '%s' "${value}" >"${path}"
  )
  chmod 400 "${path}"
}

stage_secret "${SECRET_DIR}/exec.box_token" "${BOX_TOKEN_VALUE}"
stage_secret "${SECRET_DIR}/exec.host_token" "${BOX_HOST_TOKEN_VALUE}"
stage_secret "${SECRET_DIR}/host.box_token" "${BOX_TOKEN_VALUE}"
stage_secret "${SECRET_DIR}/host.host_token" "${BOX_HOST_TOKEN_VALUE}"

env BOX_TOKEN_FILE="${SECRET_DIR}/exec.box_token" \
  BOX_HOST_TOKEN_FILE="${SECRET_DIR}/exec.host_token" \
  box-exec &
record $!
env BOX_TOKEN_FILE="${SECRET_DIR}/host.box_token" \
  BOX_HOST_TOKEN_FILE="${SECRET_DIR}/host.host_token" \
  box-host &
record $!

# Net for the case where a daemon dies before it unlinks its own copy.
(
  sleep 30
  rm -rf "${SECRET_DIR}"
) >/dev/null 2>&1 &

BOX_TOKEN_VALUE=""
BOX_HOST_TOKEN_VALUE=""
BOX_VNC_PASSWORD_VALUE=""
unset BOX_TOKEN_VALUE BOX_HOST_TOKEN_VALUE BOX_VNC_PASSWORD_VALUE || true

while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      echo "a process exited (pid ${pid}); shutting down" >&2
      shutdown
      exit 1
    fi
  done
  sleep 1
done
