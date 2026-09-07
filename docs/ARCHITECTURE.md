# Architecture

Working names: **grok-box**, **askit-box**. Role: **Grok Bot Layer 3** — the sandboxed Linux computer.

## One-pager (L1–L4)

```
┌─────────────────────────────────────────────────────────────┐
│ L1  Client / desktop                                        │
│     Reference app: ./l1 (not in the guest image).           │
│     Human UI: shell, files, desktop. Talks only to          │
│     EnsureBox. Never SSHes. Never holds BOX_TOKEN.          │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│ L2  Server / control plane                                  │
│     Tool router. Owns EnsureBox lifecycle.                  │
│     Reference app: ./ensurebox (not in the guest image).    │
│     Operator console: Docker, ports, volumes, lifecycle.    │
│     Holds BOX_TOKEN. HTTP /api/v1 is the L1 wire.           │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP + Bearer
┌────────────────────────────▼────────────────────────────────┐
│ L3  grok-box  ← THIS REPOSITORY                             │
│     box-host :1340   info / health / ready / desktop/chrome │
│     box-exec :1337   exec, files, /v1/cua/*                 │
│     jail: /workspace   user: box                            │
│     Xvfb :1 1280×800, openbox, x11vnc, noVNC :6080          │
│     Chromium + profile volume; CDP 127.0.0.1 only           │
└────────────────────────────┬────────────────────────────────┘
                             │ inference only (not this repo)
┌────────────────────────────▼────────────────────────────────┐
│ L4  open-ai-gateway (OAG)                                   │
│     Model calls. No workspace, no X11, no shell.            │
└──────────────────────────────────────────────────────────────┘
```

## Glossary

| Term | Meaning |
| --- | --- |
| **box-exec** | In-box HTTP daemon that runs commands, serves files, and exposes CUA actuators. Analogous *job* to an “exec daemon,” implemented here as our own service. |
| **box-host** (host gateway) | Thin in-box process that publishes identity, capability flags, and readiness. Analogous *job* to a “sand-host / host gateway.” Does **not** run models. |
| **OAG / inference gateway** | L4. OpenAI-compatible (or similar) HTTP API in front of weights. Separate process, separate repo. |
| **CUA** | Computer Use: screenshot / click / type / key / scroll against the box X display (`POST /v1/cua/*` on `box-exec`). Coordinate space is the framebuffer **1280×800**, origin top-left. |
| **L1 client** | Human UI in `./l1`: shell, files, desktop. Bearer `ENSUREBOX_TOKEN` only. Never calls guest `box-exec` / `box-host`. |
| **EnsureBox** | L2 API and operator console that creates, stops, or hibernates a box. Holds `BOX_TOKEN`. Shell/files/CUA **UI** is L1; the HTTP routes still live here. |
| **Workspace jail** | All `cwd` and file paths are resolved under `WORKSPACE_ROOT` (default `/workspace`). Commands may invoke system binaries (`/bin/echo`); they may not use a cwd or file path outside the jail. |

## Ports

| Port | Process | Routes / role |
| --- | --- | --- |
| **1337** | `box-exec` | `GET /v1/health`, `POST /v1/exec`, `GET\|PUT /v1/files`, `POST /v1/cua/*` |
| **1340** | `box-host` | `GET /v1/health`, `GET /v1/ready`, `GET /v1/info`, `GET /v1/desktop`, `GET /v1/chrome` |
| **6080** | websockify + noVNC | Viewer HTML at `/vnc.html`. Published by Compose. |
| 5900 | x11vnc | RFB on **localhost only** (`BOX_VNC_BIND`). Not published. |
| 9222 | Chromium CDP | **localhost only**. Not published. |

Bind addresses: `BOX_EXEC_BIND` / `BOX_HOST_BIND` (default `0.0.0.0:1337` and `0.0.0.0:1340`).

## Auth model

- **Shared secret:** `BOX_TOKEN`. L2 generates it when EnsureBox creates the container and stores it next to the box record.
- **Optional split:** `BOX_HOST_TOKEN` for `box-host` `/v1/info`, `/v1/desktop`, `/v1/chrome`. If unset or empty, `box-host` uses `BOX_TOKEN`.
- **Header:** `Authorization: Bearer <token>`. Comparison is constant-time on equal-length tokens.
- **Unauthenticated:** `/v1/health` on both daemons, and `/v1/ready` on `box-host` (orchestrator probes).
- **Authenticated:** everything else, including file I/O, CUA, and `/v1/info`.
- **Docker:** the entrypoint exits if `BOX_TOKEN` is missing. Local `cargo run` falls back to `dev-box-token` and logs a warning.
- **Viewer:** noVNC is not Bearer-authenticated. x11vnc uses a VNC password (first 8 characters of `BOX_TOKEN`, or `BOX_VNC_PASSWORD`). Bind-localhost on RFB plus Compose port mapping on 6080 is the network control.

WebSocket streaming for exec is **not** in this tree. L2 should use `POST /v1/exec` (bounded output, timeout).

## Process model inside the image

```
tini
 └── entrypoint.sh
      ├── Xvfb :1  (1280x800x24)          if BOX_DESKTOP=1
      ├── openbox
      ├── x11vnc 127.0.0.1:5900
      ├── websockify/noVNC :6080
      ├── chromium (profile volume; CDP 127.0.0.1:9222)
      │     not in the death-watch — closing the browser must not kill the box
      ├── box-exec   (1337)
      └── box-host   (1340)  ──probes──► 127.0.0.1:1337/v1/health
                                         + X socket when desktop is required
```

If `box-exec` or `box-host` (or the X/VNC stack) dies, the entrypoint stops siblings and the container exits so L2 can restart or replace it. Chromium exiting is ignored.

Runtime user is `box` (uid 1000), not root. Ports are unprivileged.

`GET /v1/ready` is 200 when exec health succeeds, and when `BOX_DESKTOP_REQUIRED=1` the X display probe must also succeed. Chrome is **not** on the ready path.

`GET /v1/info` `capabilities`:

| Flag | True when |
| --- | --- |
| `exec` | always (this binary) |
| `files` | always |
| `desktop` | X socket (and `xdpyinfo` when present) on `BOX_DISPLAY` |
| `chrome` | Chromium pid/process alive on that display |
| `cua` | `BOX_CUA` enabled and the display socket exists |

## Path jail

`box-common::resolve_in_jail`:

1. Reject NUL and overlong paths.
2. Join relative paths to the workspace root; absolute paths must already be under the root.
3. Lexically collapse `.` / `..`.
4. `canonicalize` existing paths (follows symlinks) and require the result still be inside the root.
5. For new files, canonicalize the nearest existing ancestor and append the remainder.

`/workspace-evil` is **not** treated as inside `/workspace` (`Path::starts_with` is component-wise).

## Computer Use (Linux X11, default)

CUA is first-party in this image:

- Screenshot: ImageMagick `import -window root` (fallback: `scrot`)
- Pointer/keyboard: `xdotool` on `DISPLAY=:1`
- Coordinate space = X framebuffer **1280×800** (see `BOX_DISPLAY_GEOM`)
- Endpoints live on `box-exec` and share `BOX_TOKEN`

This is the path `docker compose up --build` enables.

## Pluggable CUA backend (not vendored)

**[trycua/cua](https://github.com/trycua/cua)** (Lume / `computer-server`) is a **pluggable** computer-use backend for **macOS and Windows later**. It is not the default in this Linux image and is **not** vendored here. A future adapter can swap the xdotool/import implementation behind the same `/v1/cua/*` wire without changing L2. Do not block Linux CUA on that tree.

Windows and macOS remain **clients** and/or **Docker hosts** for this Linux box; they are not a native grok-box OS.

## EnsureBox notes (L2-owned)

The image is a **guest**. L2 decides when a box exists.

A reference control plane lives in [`ensurebox/`](../ensurebox/README.md). It is a Next.js app with a **thin operator console** (ports, volumes, container, lifecycle) and `/api/v1/boxes*` routes. It is **not** baked into the grok-box image (see `.dockerignore`). The operator UI does not include shell, files, or CUA.

A reference L1 client lives in [`l1/`](../l1/README.md). It is the human workspace UI (shell, files, desktop). It talks **only** to EnsureBox (`ENSUREBOX_TOKEN`) and never holds `BOX_TOKEN`.

| Operation | L2 action | Volume |
| --- | --- | --- |
| **create** | `docker run` from `GROK_BOX_IMAGE`, inject `BOX_ID` + `BOX_TOKEN` via env file, publish unique host ports on 127.0.0.1 | New `/workspace` + chrome-profile under `ensurebox/data/volumes/<id>/` |
| **wait ready** | Poll guest `GET :1340/v1/ready` until 200 | — |
| **use** | Tool router → guest `:1337` with the stored token; viewer `:6080` | Writes persist on the volumes |
| **stop** | `docker stop`; keep container | Workspace + profile retained |
| **hibernate** | Stop compute, keep volumes | Resume = `docker start` + wait ready |
| **destroy** | `docker rm -f` **and** delete volumes | Gone |

Hibernation is a volume policy, not a feature of `box-exec`.

Recommended env on create:

```
BOX_ID=<uuid>
BOX_TOKEN=<high-entropy>
WORKSPACE_ROOT=/workspace
BOX_DISPLAY=:1
BOX_DISPLAY_GEOM=1280x800x24
BOX_DESKTOP=1
BOX_DESKTOP_REQUIRED=1
BOX_CHROME=1
BOX_CUA=1
RUST_LOG=info
```

Network: bind 1337/1340/6080 on a private fabric. Do not expose them to the public internet without an extra proxy. Never publish CDP (9222) or raw VNC (5900).

## What is intentionally missing

- No model weights, no OpenAI wire on 1337/1340
- No proprietary Cursor binaries or package names
- No vendored trycua/Lume (pluggable later; Linux X11 is default)
- Optional WebSocket exec streaming
