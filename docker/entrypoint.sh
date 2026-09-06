#!/bin/bash
set -euo pipefail

if [[ -z "${BOX_TOKEN:-}" ]]; then
  echo "BOX_TOKEN must be set" >&2
  exit 1
fi

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

  echo "starting Xvfb ${BOX_DISPLAY} ${xvfb_screen}"
  Xvfb "${BOX_DISPLAY}" -screen 0 "${xvfb_screen}" -ac +extension GLX +render -noreset &
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

  echo "starting openbox on ${DISPLAY}"
  openbox &
  record $!

  mkdir -p "${HOME:-/home/box}/.vnc"
  passfile="${HOME:-/home/box}/.vnc/passwd"
  vnc_pass="${BOX_VNC_PASSWORD:-${BOX_TOKEN}}"
  vnc_pass="${vnc_pass:0:8}"
  x11vnc -storepasswd "${vnc_pass}" "${passfile}" >/dev/null
  chmod 600 "${passfile}"

  echo "starting x11vnc on ${BOX_VNC_BIND} (localhost only)"
  x11vnc \
    -display "${BOX_DISPLAY}" \
    -rfbport "$(vnc_port)" \
    -localhost \
    -rfbauth "${passfile}" \
    -forever \
    -shared \
    -noxdamage \
    >/tmp/x11vnc.log 2>&1 &
  record $!

  if [[ ! -d "${BOX_NOVNC_WEB}" ]]; then
    echo "noVNC web root missing: ${BOX_NOVNC_WEB}" >&2
    exit 1
  fi

  echo "starting noVNC/websockify on 0.0.0.0:${BOX_NOVNC_PORT}"
  websockify --web="${BOX_NOVNC_WEB}" "0.0.0.0:${BOX_NOVNC_PORT}" "${BOX_VNC_BIND}" \
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
  read -r w h < <(geom_wh)
  export DISPLAY="${BOX_DISPLAY}"

  echo "starting ${bin} on ${DISPLAY} profile=${BOX_CHROME_PROFILE} cdp=127.0.0.1:${BOX_CDP_PORT}"
  # Closing the browser must not take the box down — do not record this pid.
  "${bin}" \
    --user-data-dir="${BOX_CHROME_PROFILE}" \
    --no-first-run \
    --no-default-browser-check \
    --disable-dev-shm-usage \
    --disable-gpu \
    --disable-software-rasterizer \
    --no-sandbox \
    --window-size="${w},${h}" \
    --window-position=0,0 \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="${BOX_CDP_PORT}" \
    about:blank \
    >/tmp/box-chrome.log 2>&1 &
  echo $! > /tmp/box-chrome.pid
}

echo "grok-box starting box_id=${BOX_ID:-grok-box} workspace=${WORKSPACE_ROOT} desktop=${BOX_DESKTOP} chrome=${BOX_CHROME} cua=${BOX_CUA}"

if flag_on "${BOX_DESKTOP}"; then
  start_desktop
  if flag_on "${BOX_CHROME}"; then
    start_chrome
  fi
fi

box-exec &
record $!

box-host &
record $!

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
