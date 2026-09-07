# grok-box

A sandboxed Linux computer for agents: a guest Docker image, two HTTP daemons (`box-exec` and `box-host`), a `grok-box` CLI, and connect-only SDKs (Rust, TypeScript, Python).

You start the guest. Then you talk to it over HTTP with a URL pair and a bearer token. This repo does **not** publish packages to crates.io, npm, or PyPI.

License: **MIT**. MSRV: Rust **1.85**.

## What you get

| Piece | Role |
| --- | --- |
| Guest image `grok-box` | Linux box: shell, files, 1280×800 X desktop, Chromium, Computer Use |
| `box-exec` `:1337` | Exec, files (GET/PUT/DELETE/mkdir), CUA |
| `box-host` `:1340` | Health, ready, identity, desktop/chrome status |
| CLI `grok-box` | Same surface as the SDKs |
| SDKs | Connect with `(execUrl, hostUrl, token)` — no `docker run` helper |
| [`ensurebox/`](ensurebox/) | **Demo only** — sample orchestrator / operator UI (not a supported control plane) |
| [`l1/`](l1/) | **Demo only** — sample human workspace UI (talks only to EnsureBox) |

Windows and macOS are clients or Docker hosts. The box OS is always this Linux image.

This tree implements **our own HTTP wire**. It is not Cursor’s `/exec-daemon` or `sand-host`.

## Quick start (guest)

```bash
cp .env.example .env          # optional; default token is dev-box-token
docker compose up --build
```

That builds the image and starts exec, host, Xvfb, Chromium, and CUA tools.

Health (no token):

```bash
curl -fsS http://127.0.0.1:1337/v1/health
curl -fsS http://127.0.0.1:1340/v1/health
curl -fsS http://127.0.0.1:1340/v1/ready
```

Exec (token required):

```bash
curl -fsS http://127.0.0.1:1337/v1/exec \
  -H "Authorization: Bearer dev-box-token" \
  -H "Content-Type: application/json" \
  -d '{"command":["echo","ok"]}'
```

Screenshot as JSON (base64 PNG) or raw `image/png`:

```bash
curl -fsS http://127.0.0.1:1337/v1/cua/screenshot \
  -H "Authorization: Bearer dev-box-token" \
  -X POST

curl -fsS http://127.0.0.1:1337/v1/cua/screenshot?format=png \
  -H "Authorization: Bearer dev-box-token" \
  -H "Accept: image/png" \
  -X POST \
  -o /tmp/box.png
```

CUA coordinate space is **1280×800**, origin top-left.

Desktop viewer: [http://127.0.0.1:6080/vnc.html](http://127.0.0.1:6080/vnc.html). VNC password is the first **8 characters** of `BOX_TOKEN` (or `BOX_VNC_PASSWORD`). x11vnc listens on `127.0.0.1:5900` **inside** the container; Compose publishes only noVNC on **6080**.

```bash
./scripts/smoke.sh
```

### CLI and SDKs

After the guest is up, any orchestrator (yours, or the EnsureBox demo) already has an exec URL, host URL, and token. Point the client at those. The SDKs **do not** start Docker and **ignore** `/v1/info` advertised URLs (those are container-local listen addresses).

```bash
cargo run -p grok-box -- \
  --exec-url http://127.0.0.1:1337 \
  --host-url http://127.0.0.1:1340 \
  --token dev-box-token \
  exec -- echo ok
```

Workspace packages (not published):

- Rust: `crates/grok-box` (library + `grok-box` binary)
- TypeScript: `sdk/typescript`
- Python: `sdk/python`

### Native (no Docker, no X desktop)

```bash
./scripts/run-local.sh
# another terminal
./scripts/smoke-native.sh
cargo test --workspace
```

Native mode sets `BOX_DESKTOP=0`. CUA screenshot needs the container (or a local Xvfb).

## How an orchestrator should plug in

1. Start a container from this image. Inject `BOX_TOKEN` and `BOX_ID`. Publish **1337 / 1340 / 6080** where you need them. Do **not** publish 5900 or 9222.
2. Wait until `GET <hostUrl>/v1/ready` returns 200.
3. Call `connect(execUrl, hostUrl, token)` in the CLI or an SDK. Do not parse `/v1/info.endpoints` as the public URLs.
4. Drive `POST /v1/exec`, files, and `/v1/cua/*` yourself.

[`ensurebox/`](ensurebox/) is a **demo** of that pattern. It is not a supported production control plane. [`l1/`](l1/) is a **demo** human UI that talks only to EnsureBox (`ENSUREBOX_TOKEN`). L1 never sees `BOX_TOKEN`, never SSHes, and never calls `box-exec` / `box-host`.

Demo UIs (optional):

```bash
cd ensurebox && npm install && npm run dev   # operator console, :43142
cd l1 && npm install && npm run dev          # human workspace, :43141
```

## Ports

| Port | Published? | Process | Notes |
| --- | --- | --- | --- |
| **1337** | yes | `box-exec` | exec, files, CUA. Bind `BOX_EXEC_BIND`. |
| **1340** | yes | `box-host` | health, ready, info, desktop, chrome. Bind `BOX_HOST_BIND`. |
| **6080** | yes | websockify / noVNC | Viewer. `http://127.0.0.1:6080/vnc.html` |
| 5900 | **no** | x11vnc | `BOX_VNC_BIND=127.0.0.1:5900` inside the image |
| 9222 | **no** | Chromium CDP | `127.0.0.1` only (`BOX_CDP_PORT`). Do not publish. |

## Environment

| Variable | Default (image) | Meaning |
| --- | --- | --- |
| `BOX_TOKEN` | **required in Docker** | Bearer token for exec, CUA, and host `/v1/info` |
| `BOX_HOST_TOKEN` | same as `BOX_TOKEN` | Optional split token for host info/desktop/chrome |
| `BOX_ID` | hostname / `grok-box` | Reported by `/v1/info` |
| `WORKSPACE_ROOT` | `/workspace` | Jail root for cwd and file APIs |
| `BOX_EXEC_BIND` | `0.0.0.0:1337` | Exec listen address |
| `BOX_HOST_BIND` | `0.0.0.0:1340` | Host listen address |
| `BOX_EXEC_URL` | `http://127.0.0.1:1337` | URL host uses to probe exec (container-local) |
| `BOX_CORS_ORIGINS` | empty (no browser origins) | Comma-separated allowlist; `*` is ignored |
| `BOX_DISPLAY` | `:1` | X display |
| `BOX_DISPLAY_GEOM` | `1280x800x24` | Xvfb geometry; **CUA coordinate space is 1280×800** |
| `BOX_DESKTOP` | `1` | Start Xvfb + openbox + x11vnc + noVNC |
| `BOX_DESKTOP_REQUIRED` | `1` when desktop on | `/v1/ready` waits for the display |
| `BOX_VNC_BIND` | `127.0.0.1:5900` | x11vnc (localhost only) |
| `BOX_NOVNC_PORT` | `6080` | noVNC / websockify |
| `BOX_VNC_PASSWORD` | first 8 chars of `BOX_TOKEN` | Viewer password |
| `BOX_CHROME` | `1` | Launch Chromium on `:1` |
| `BOX_CHROME_PROFILE` | `/home/box/chrome-profile` | Persistent profile (compose volume) |
| `BOX_CDP_PORT` | `9222` | CDP on `127.0.0.1` only |
| `BOX_CUA` | `1` | Enable `/v1/cua/*` |

## Auth

Send `Authorization: Bearer <token>`. Health and ready stay unauthenticated so an orchestrator / Compose can probe them. The container **refuses to start** if `BOX_TOKEN` is missing. Local `cargo run` falls back to `dev-box-token`.

`BOX_TOKEN` is stripped from processes spawned by `/v1/exec`. Do not put it in L1 or any other untrusted client.

## Layout

```
crates/box-common    path jail, bearer compare, error envelope, config, CORS
crates/box-exec      exec + files + CUA HTTP daemon
crates/box-host      identity / ready / capabilities / desktop + chrome status
crates/box-desktop   Xvfb probe, 1280×800 geometry, viewer URL
crates/box-chrome    Chromium profile + localhost CDP probe
crates/box-cua       screenshot / click / type / key / scroll / double-click / drag / move
crates/grok-box      typed client + CLI (workspace only, not published)
sdk/typescript       TypeScript client (workspace only)
sdk/python           Python client (workspace only)
ensurebox/           demo orchestrator (not production)
l1/                  demo human UI (EnsureBox only)
```

## Volumes

| Mount | Role |
| --- | --- |
| `/workspace` | Jail root for cwd and file APIs. Persist across hibernate. |
| `/home/box/chrome-profile` | Chromium `--user-data-dir`. Persist cookies/session. Must be writable by uid **1000**; otherwise the entrypoint falls back to `/tmp/box-chrome-profile`. |

## Docs

- [Deploy](docs/DEPLOY.md) — test-deploy on **Akamai Cloud** (Linode; not Vultr), then the same pattern on AWS/GCP/Azure. First test is one VM, guest Compose only, private SSH tunnel or Tailscale; CLI/SDK from your laptop. Do not expose 1337/1340/6080 on the public internet.
- [Architecture](docs/ARCHITECTURE.md)
- [Startup](docs/STARTUP.md)
- [Request processing](docs/PROCESSING.md)
- [Terminology](docs/TERMINOLOGY.md)
- [HTTP API](docs/API.md) · [OpenAPI](docs/openapi.yaml)

## What this is not

- Not a supported production control plane (EnsureBox is a demo)
- Not L4 / not an OpenAI-compatible inference gateway
- Not a re-host of any proprietary exec/sand-host binary
- Not a native Windows or macOS box OS
- Not a vendored [trycua/cua](https://github.com/trycua/cua) tree — Linux X11 is the CUA backend
- Not published to crates.io, npm, or PyPI
