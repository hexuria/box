# Architecture

**grok-box** is the guest: a Linux image, two HTTP daemons, a CLI, and connect-only SDKs. Callers start the container themselves, then pass **exec URL + host URL + token** into the client.

[`ensurebox/`](../ensurebox/) and [`l1/`](../l1/) are **demos**. EnsureBox is not a supported production control plane.

## Product vs demos

```
Your orchestrator (or the EnsureBox demo)
    │  starts guest, remembers published URLs + BOX_TOKEN
    │  grok-box.connect(execUrl, hostUrl, token)
    ▼
grok-box guest (this image)
    ├── box-host :1340   identity, capabilities, ready, desktop/chrome
    ├── box-exec :1337   exec + files + /v1/cua/*
    ├── Xvfb :1 1280×800 + openbox + x11vnc + noVNC :6080
    └── Chromium (profile volume; CDP on localhost only)
```

The TypeScript / Python / Rust SDKs never call `docker run` and never treat `/v1/info.endpoints` as the URLs to dial. Those endpoints are **container-local listen addresses** so operators can see what the processes bound.

Demo-only path (not required to use the product):

```
 L1 demo UI  (./l1 — Win / Mac / Linux)
    │  Bearer ENSUREBOX_TOKEN only
    ▼
 EnsureBox demo  (./ensurebox)  — sample lifecycle + HTTP proxy
    │  Bearer BOX_TOKEN (never sent to L1)
    ▼
 grok-box guest
```

L1 never SSHes, never holds `BOX_TOKEN`, and never talks to `box-exec` / `box-host`.

## Glossary (short)

Full list: [TERMINOLOGY.md](TERMINOLOGY.md).

| Term | Meaning |
| --- | --- |
| **grok-box** | Public product name, workspace crate, and CLI binary |
| **box-exec** | In-box HTTP daemon: commands, files, CUA |
| **box-host** | In-box identity / readiness / desktop+chrome status. Does **not** run models |
| **CUA** | Computer Use against the X framebuffer **1280×800**, origin top-left |
| **SDK v1** | `connect(execUrl, hostUrl, token)` only |
| **EnsureBox / L1** | Demos of an orchestrator and a human UI |

## Ports

| Port | Process | Routes / role |
| --- | --- | --- |
| **1337** | `box-exec` | `GET /v1/health`, `POST /v1/exec`, `GET\|PUT\|DELETE /v1/files`, `POST /v1/files/mkdir`, `POST /v1/cua/*` |
| **1340** | `box-host` | `GET /v1/health`, `GET /v1/ready`, `GET /v1/info`, `GET /v1/desktop`, `GET /v1/chrome` |
| **6080** | websockify + noVNC | Viewer HTML at `/vnc.html`. Published by Compose. |
| 5900 | x11vnc | RFB on **localhost only** (`BOX_VNC_BIND`). Not published. |
| 9222 | Chromium CDP | **localhost only**. Not published. |

Bind addresses: `BOX_EXEC_BIND` / `BOX_HOST_BIND` (default `0.0.0.0:1337` and `0.0.0.0:1340`).

## Auth model

- **Shared secret:** `BOX_TOKEN`. Whoever starts the guest injects it.
- **Optional split:** `BOX_HOST_TOKEN` for `box-host` `/v1/info`, `/v1/desktop`, `/v1/chrome`. If unset or empty, `box-host` uses `BOX_TOKEN`.
- **Header:** `Authorization: Bearer <token>`. Comparison is constant-time on equal-length tokens.
- **Unauthenticated:** `/v1/health` on both daemons, and `/v1/ready` on `box-host`.
- **Authenticated:** everything else, including file I/O, CUA, and `/v1/info`.
- **Docker:** the entrypoint exits if `BOX_TOKEN` is missing. Local `cargo run` falls back to `dev-box-token` and logs a warning.
- **Exec children:** `BOX_TOKEN`, `BOX_HOST_TOKEN`, and `BOX_VNC_PASSWORD` are stripped from the child environment.
- **Viewer:** noVNC is not Bearer-authenticated. x11vnc uses a VNC password (first 8 characters of `BOX_TOKEN`, or `BOX_VNC_PASSWORD`).
- **CORS:** default is no browser origins. Set `BOX_CORS_ORIGINS` to an explicit comma-separated list if a browser must call the guest. `*` is ignored.

WebSocket streaming for exec is **not** in this tree. Use `POST /v1/exec` (bounded output, timeout; stdout/stderr are kept on timeout).

## `/v1/info` URLs

`GET /v1/info` reports `endpoints.exec` / `endpoints.host` as **container-local** HTTP URLs derived from the listen binds (`0.0.0.0` → `127.0.0.1`). `endpoints.scope` is `container-local`.

That is inventory for the process inside the guest, not a second connect source of truth. SDKs and the CLI always use the URLs the caller passed to `connect`.

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

If `box-exec` or `box-host` (or the X/VNC stack) dies, the entrypoint stops siblings and the container exits so the orchestrator can restart or replace it. Chromium exiting is ignored.

Runtime user is `box` (uid 1000), not root. Ports are unprivileged.

`GET /v1/ready` is 200 when exec health succeeds, and when `BOX_DESKTOP_REQUIRED=1` the X display probe must also succeed. Chrome is **not** on the ready path. Compose healthcheck hits `/v1/ready`.

`GET /v1/info` `capabilities`:

| Flag | True when |
| --- | --- |
| `exec` | always (this binary) |
| `files` | always |
| `desktop` | X socket (and `xdpyinfo` when present) on `BOX_DISPLAY` |
| `chrome` | Chromium process and/or localhost CDP is up |
| `cua` | `BOX_CUA` enabled and the display socket exists |

## Path jail

`box-common::resolve_in_jail`:

1. Reject NUL and overlong paths.
2. Join relative paths to the workspace root; absolute paths must already be under the root.
3. Lexically collapse `.` / `..`.
4. `canonicalize` existing paths (follows symlinks) and require the result still be inside the root.
5. For new files, canonicalize the nearest existing ancestor and append the remainder.

`/workspace-evil` is **not** treated as inside `/workspace` (`Path::starts_with` is component-wise).

Files v1: `GET` / `PUT` / `DELETE` `/v1/files`, and `POST /v1/files/mkdir`.

## Computer Use (Linux X11)

CUA is first-party in this image:

- Screenshot: ImageMagick `import -window root` (fallback: `scrot`). JSON (base64) **or** raw `image/png` (`Accept: image/png` or `?format=png`)
- Pointer/keyboard: `xdotool` on `DISPLAY=:1`
- Coordinate space = X framebuffer **1280×800** (see `BOX_DISPLAY_GEOM`), origin top-left
- Verbs: screenshot, click, double-click, move (hover), drag, type, key, scroll
- Endpoints live on `box-exec` and share `BOX_TOKEN`

**trycua** is not vendored and is not on the guest path. Windows/macOS remain clients or Docker hosts, not a native grok-box OS.

## Clients

Workspace-only (do not publish):

1. **Rust** `grok-box` — `GrokBox::connect(exec_url, host_url, token)` plus CLI
2. **TypeScript** `sdk/typescript` — same connect
3. **Python** `sdk/python` — same connect

The EnsureBox demo’s guest HTTP helper uses the TypeScript SDK. L1 still talks only to EnsureBox `/api/v1`.

## What is intentionally missing

- No model weights, no OpenAI wire on 1337/1340
- No proprietary Cursor binaries or package names
- No vendored trycua/Lume
- No `Sandbox.create()` / `docker run` in the SDK
- Optional WebSocket exec streaming
- Next.js is not on the guest path
