# Architecture

Working names: **grok-box**, **askit-box**. Role: **Grok Bot Layer 3** — the sandboxed Linux computer.

## One-pager (L1–L4)

```
┌─────────────────────────────────────────────────────────────┐
│ L1  Client / desktop                                        │
│     Human UI. Talks to L2. Never SSHes into the box.        │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│ L2  Server / control plane                                  │
│     Tool router. Owns EnsureBox lifecycle.                  │
│     Holds BOX_TOKEN. Does not execute agent shell itself.   │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP + Bearer
┌────────────────────────────▼────────────────────────────────┐
│ L3  grok-box  ← THIS REPOSITORY                             │
│     box-host :1340   info / health / ready                  │
│     box-exec :1337   exec, files, (later CUA)               │
│     jail: /workspace   user: box                            │
│     Phase 2+: X display, Chromium, CUA actuators            │
└────────────────────────────┬────────────────────────────────┘
                             │ inference only (not this repo)
┌────────────────────────────▼────────────────────────────────┐
│ L4  open-ai-gateway (OAG)                                   │
│     Model calls. No workspace, no X11, no shell.            │
└─────────────────────────────────────────────────────────────┘
```

## Glossary

| Term | Meaning |
| --- | --- |
| **box-exec** | In-box HTTP daemon that runs commands and serves files. Analogous *job* to an “exec daemon,” implemented here as our own service. |
| **box-host** (host gateway) | Thin in-box process that publishes identity, capability flags, and readiness. Analogous *job* to a “sand-host / host gateway.” Does **not** run models. |
| **OAG / inference gateway** | L4. OpenAI-compatible (or similar) HTTP API in front of weights. Separate process, separate repo. |
| **CUA** | Computer Use: screenshot / click / type against the box X display. Planned on `box-exec` under `/v1/cua/*`. |
| **EnsureBox** | L2 API/workflow that creates, stops, or hibernates a box. **Server-owned.** This image is the guest, not the orchestrator. |
| **Workspace jail** | All `cwd` and file paths are resolved under `WORKSPACE_ROOT` (default `/workspace`). Commands may invoke system binaries (`/bin/echo`); they may not use a cwd or file path outside the jail. |

## Ports

| Port | Process | Phase 1 routes |
| --- | --- | --- |
| **1337** | `box-exec` | `GET /v1/health`, `POST /v1/exec`, `GET|PUT /v1/files` |
| **1340** | `box-host` | `GET /v1/health`, `GET /v1/ready`, `GET /v1/info` |
| 6080 | noVNC viewer | Phase 2 (not bound) |
| 5900 | x11vnc | Phase 2 (not bound) |

Bind addresses: `BOX_EXEC_BIND` / `BOX_HOST_BIND` (default `0.0.0.0:1337` and `0.0.0.0:1340`).

## Auth model

- **Shared secret:** `BOX_TOKEN`. L2 generates it when EnsureBox creates the container and stores it next to the box record.
- **Optional split:** `BOX_HOST_TOKEN` for `box-host` `/v1/info`. If unset or empty, `box-host` uses `BOX_TOKEN`.
- **Header:** `Authorization: Bearer <token>`. Comparison is constant-time on equal-length tokens.
- **Unauthenticated:** `/v1/health` on both daemons, and `/v1/ready` on `box-host` (orchestrator probes).
- **Authenticated:** everything else, including file I/O and `/v1/info`.
- **Docker:** the entrypoint exits if `BOX_TOKEN` is missing. Local `cargo run` falls back to `dev-box-token` and logs a warning.

WebSocket streaming for exec is **not** in Phase 1. L2 should use `POST /v1/exec` (bounded output, timeout). A `/v1/ws` stream can be added later without changing the host gateway.

## Process model inside the image

```
tini
 └── entrypoint.sh
      ├── box-exec   (1337)
      └── box-host   (1340)  ──probes──► 127.0.0.1:1337/v1/health
```

If either daemon dies, the entrypoint stops the sibling and the container exits so L2 can restart or replace it.

Runtime user is `box` (uid 1000), not root. Ports are unprivileged.

## Path jail

`box-common::resolve_in_jail`:

1. Reject NUL and overlong paths.
2. Join relative paths to the workspace root; absolute paths must already be under the root.
3. Lexically collapse `.` / `..`.
4. `canonicalize` existing paths (follows symlinks) and require the result still be inside the root.
5. For new files, canonicalize the nearest existing ancestor and append the remainder.

`/workspace-evil` is **not** treated as inside `/workspace` (`Path::starts_with` is component-wise).

## Phase roadmap

### Phase 1 — MVP (this tree)

Working Cargo workspace + image:

- Exec + files + health
- Host info / ready
- Jail + auth tests
- Compose + `scripts/smoke.sh`

### Phase 2 — Desktop

Crate: `box-desktop` (stub).

- Xvfb on `DISPLAY=:1`
- x11vnc + noVNC / websockify
- `capabilities.desktop = true`
- Viewer URL on `box-host`

### Phase 3 — Browser

Crate: `box-chrome` (stub).

- Chromium with `--user-data-dir=/home/box/chrome-profile`
- Persist cookies across hibernate via that volume
- `capabilities.chrome = true`

### Phase 4 — CUA

Crate: `box-cua` (stub). Endpoints on `box-exec`:

- `POST /v1/cua/screenshot`
- `POST /v1/cua/click`, `/type`, `/key`
- Requires Phase 2 display
- Still no inference in this image

### Phase 5 — L2 lifecycle (not in this image)

Documented below. Code lives in the L2 control plane.

## EnsureBox notes (L2-owned)

The image is a **guest**. L2 decides when a box exists.

Suggested operations (names are illustrative):

| Operation | L2 action | Volume |
| --- | --- | --- |
| **create** | `docker run` / kube Pod from `grok-box`, inject `BOX_ID` + `BOX_TOKEN`, attach network | New or reused `/workspace` volume |
| **wait ready** | Poll `GET :1340/v1/ready` until 200 | — |
| **use** | Tool router → `:1337` with the token | Writes persist on the volume |
| **stop** | `docker stop` / delete Pod; keep volume | Workspace retained |
| **hibernate** | Stop compute, keep `/workspace` and `/home/box/chrome-profile` | Resume = create + same volumes + same or new token |
| **destroy** | Delete container **and** volumes | Gone |

Hibernation is a volume policy, not a feature of `box-exec`. Do not put EnsureBox in this repository.

Recommended env on create:

```
BOX_ID=<uuid>
BOX_TOKEN=<high-entropy>
WORKSPACE_ROOT=/workspace
RUST_LOG=info
```

Network: bind 1337/1340 on a private fabric. Do not expose them to the public internet without an extra proxy.

## What is intentionally missing

- No model weights, no OpenAI wire on 1337/1340
- No proprietary Cursor binaries or package names
- No desktop/CUA processes in the Phase 1 image
- Optional WebSocket exec streaming (Phase 1.5+)
