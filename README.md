# grok-box

**Grok Bot Layer 3 — sandboxed agent computer**

`grok-box` (also called askit-box) is the Linux box where an agent runs shell, reads and writes files, views a virtual desktop, drives Chromium, and performs Computer Use (CUA). It is a Cargo workspace plus one Docker image. It is not an inference server and not a control plane.

License: **MIT**. MSRV: Rust **1.85**.

## What this repo is

| Layer | Role | This repo? |
| --- | --- | --- |
| L1 | Client / desktop UI | **Reference app in [`l1/`](l1/)** — talks only to EnsureBox; not in the guest image |
| L2 | Server / control plane: tool router + **EnsureBox** lifecycle | **Reference app in [`ensurebox/`](ensurebox/)** — not in the guest image |
| **L3** | **Sandboxed Linux computer: `box-exec` + `box-host` + X desktop + Chrome + CUA** | **Yes (this image)** |
| L4 | open-ai-gateway (model inference) | No |

```
 L1 client  (./l1 — Win / Mac / Linux UI)
    │  Bearer ENSUREBOX_TOKEN only
    ▼
 L2 tool router ── EnsureBox (./ensurebox)
    │  Bearer BOX_TOKEN (never sent to L1)
    ▼
 L3 grok-box (this repo, Linux image)
    ├── box-host :1340   identity, capabilities, ready, desktop/chrome status
    ├── box-exec :1337   exec + files + /v1/cua/*
    ├── Xvfb :1 1280×800 + openbox + x11vnc + noVNC :6080
    └── Chromium (profile volume; CDP on localhost only)
    │
    ▼  (models stay elsewhere)
 L4 open-ai-gateway
```

This repository implements **our own wire**. It is not Cursor’s `/exec-daemon` or `sand-host`, does not clone those binaries, and does not reuse their package names as if they were official.

Windows and macOS can **host Docker** or run the L1 client. They are not a native grok-box OS; the box itself is always this Linux image.

## Quick start

```bash
cp .env.example .env          # optional; default token is dev-box-token
docker compose up --build
```

That single command starts exec, host, the virtual desktop, Chromium, and CUA tools.

To use the Layer 1 client against EnsureBox instead of curling the guest:

```bash
cd ensurebox && npm install && npm run dev   # http://127.0.0.1:43142
cd l1 && npm install && npm run dev          # http://127.0.0.1:43141
```

Health (no token):

```bash
curl -fsS http://127.0.0.1:1337/v1/health
curl -fsS http://127.0.0.1:1340/v1/health
curl -fsS http://127.0.0.1:1340/v1/ready
```

Exec:

```bash
curl -fsS http://127.0.0.1:1337/v1/exec \
  -H "Authorization: Bearer dev-box-token" \
  -H "Content-Type: application/json" \
  -d '{"command":["echo","ok"]}'
```

Screenshot (CUA; 1280×800 PNG as base64 JSON):

```bash
curl -fsS http://127.0.0.1:1337/v1/cua/screenshot \
  -H "Authorization: Bearer dev-box-token" \
  -X POST
```

Desktop viewer: open [http://127.0.0.1:6080/vnc.html](http://127.0.0.1:6080/vnc.html). VNC password is the first **8 characters** of `BOX_TOKEN` (or `BOX_VNC_PASSWORD` if set). x11vnc itself listens on `127.0.0.1:5900` **inside** the container; Compose publishes only noVNC on **6080**.

Full smoke (health, exec, files, 401, host info, screenshot, optional click):

```bash
./scripts/smoke.sh
```

### Native (no Docker, no X desktop)

```bash
./scripts/run-local.sh
# another terminal
./scripts/smoke-native.sh
cargo test --workspace
```

Native mode sets `BOX_DESKTOP=0`. CUA screenshot needs the container (or a local Xvfb).

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
| `BOX_EXEC_URL` | `http://127.0.0.1:1337` | URL host uses to probe exec |
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

Send `Authorization: Bearer <token>`. Health and ready stay unauthenticated so L2 / Compose can probe them. The container **refuses to start** if `BOX_TOKEN` is missing. Local `cargo run` falls back to `dev-box-token`.

## How L2 should plug in

1. **EnsureBox** (L2, not this image): create a container from `grok-box`, mount durable volumes at `/workspace` and `/home/box/chrome-profile`, inject `BOX_TOKEN` + `BOX_ID`, publish **1337 / 1340 / 6080** on an internal network. Do **not** publish 5900 or 9222.
2. Wait until `GET http://<box>:1340/v1/ready` returns 200 (exec up, and desktop up when `BOX_DESKTOP_REQUIRED=1`).
3. Discover features via `GET /v1/info`. In this image capabilities are `exec`, `files`, `desktop`, `chrome`, `cua`.
4. Route agent tools to `box-exec`:
   - shell → `POST /v1/exec`
   - read/write → `GET` / `PUT /v1/files`
   - computer use → `POST /v1/cua/screenshot|click|type|key|scroll`
5. Humans (or L1) can attach to noVNC on 6080 with the VNC password.
6. Send **inference** to L4 (open-ai-gateway). Do not point the model at `box-host`.

See [l1/README.md](l1/README.md) for the Layer 1 client (talks only to EnsureBox).

See [ensurebox/README.md](ensurebox/README.md) for the Layer 2 control plane (create guest, wait ready, route tools).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md), and [docs/openapi.yaml](docs/openapi.yaml).

## Crate layout

```
crates/box-common    path jail, bearer compare, error envelope, config
crates/box-exec      exec + files + CUA HTTP daemon
crates/box-host      identity / ready / capabilities / desktop + chrome status
crates/box-desktop   Xvfb probe, 1280×800 geometry, viewer URL
crates/box-chrome    Chromium profile + localhost CDP probe
crates/box-cua       screenshot / click / type / key / scroll against X11
```

## Volumes

| Mount | Role |
| --- | --- |
| `/workspace` | Jail root for cwd and file APIs. Persist across hibernate. |
| `/home/box/chrome-profile` | Chromium `--user-data-dir`. Persist cookies/session. Must be writable by uid **1000**; otherwise the entrypoint falls back to `/tmp/box-chrome-profile`. |

## What this is not

- Not L4 / not an OpenAI-compatible inference gateway
- Not L2 box orchestration (create/stop/hibernate)
- Not a re-host of any proprietary exec/sand-host binary
- Not a native Windows or macOS box OS (those are clients / Docker hosts)
- Not a vendored [trycua/cua](https://github.com/trycua/cua) tree — Linux X11 is the default CUA backend; trycua is a later pluggable backend for macOS/Windows (see ARCHITECTURE)
