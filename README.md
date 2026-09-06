# grok-box

**Grok Bot Layer 3 — sandboxed agent computer**

`grok-box` (also called askit-box) is the Linux box where an agent actually runs shell, reads and writes files, and — later — uses a desktop, Chromium, and Computer Use (CUA). It is a small Cargo workspace plus a Docker image. It is not an inference server and not a control plane.

License: **MIT**. MSRV: Rust **1.85**.

## What this repo is

| Layer | Role | This repo? |
| --- | --- | --- |
| L1 | Client / desktop UI | No |
| L2 | Server / control plane: tool router + **EnsureBox** lifecycle | No — L2 *calls* this image |
| **L3** | **Sandboxed computer: `box-exec` + `box-host`** | **Yes** |
| L4 | open-ai-gateway (model inference) | No |

```
 L1 client
    │
    ▼
 L2 tool router ── EnsureBox (create / stop / hibernate volumes)
    │  Bearer BOX_TOKEN
    ▼
 L3 grok-box (this repo)
    ├── box-host :1340   identity, capabilities, ready
    └── box-exec :1337   exec + files (cwd / path jail = /workspace)
    │
    ▼  (models stay elsewhere)
 L4 open-ai-gateway
```

This repository implements **our own wire** for those jobs. It is not Cursor’s `/exec-daemon` or `sand-host`, does not clone those binaries, and does not reuse their package names as if they were official.

## Phase 1 (shipped)

- **`box-exec`** — HTTP daemon on **1337**
  - Bearer auth (`BOX_TOKEN`)
  - `POST /v1/exec` — run a command, cwd jailed under `/workspace`, capture stdout/stderr/exit, timeout
  - `GET /v1/files` + `PUT /v1/files` — read/write (and list) only under `/workspace`
  - `GET /v1/health`
  - Structured JSON errors
- **`box-host`** — host gateway on **1340**
  - `GET /v1/health`, `GET /v1/ready` (ready probes `box-exec`)
  - `GET /v1/info` — box id, capabilities, versions (auth required)
  - Same `BOX_TOKEN`, or optional `BOX_HOST_TOKEN`
  - No model inference
- Docker image (user `box`) + `docker-compose.yml` + smoke scripts
- Workspace jail unit tests + HTTP auth/path tests

Phase 2+ (desktop, Chromium, CUA) is stubbed only. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

### Docker Compose

```bash
cp .env.example .env          # optional; default token is dev-box-token
docker compose up --build
```

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

Full smoke (build image, hit health + exec):

```bash
./scripts/smoke.sh
```

### Native (no Docker)

```bash
./scripts/run-local.sh
# another terminal
./scripts/smoke-native.sh
```

```bash
cargo test --workspace
```

## Auth

| Variable | Used by | Default |
| --- | --- | --- |
| `BOX_TOKEN` | `box-exec` (all routes except health); `box-host` `/v1/info` | `dev-box-token` if unset **outside** Docker |
| `BOX_HOST_TOKEN` | `box-host` `/v1/info` only | same as `BOX_TOKEN` |

The container **refuses to start** if `BOX_TOKEN` is missing. Send `Authorization: Bearer <token>`. Health and ready stay unauthenticated so L2 / Compose can probe them.

## How L2 should plug in

1. **EnsureBox** (L2, not this image): create a container from `grok-box`, mount a durable volume at `/workspace` (and later `/home/box/chrome-profile`), inject `BOX_TOKEN` + `BOX_ID`, publish 1337/1340 on an internal network.
2. Wait until `GET http://<box>:1340/v1/ready` returns 200.
3. Route agent tools to `box-exec`:
   - shell → `POST /v1/exec`
   - read/write → `GET` / `PUT /v1/files`
4. Discover features via `GET /v1/info` (`capabilities.exec` is true; `desktop` / `chrome` / `cua` are false until Phase 2+).
5. Send **inference** to L4 (open-ai-gateway). Do not point the model at `box-host`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the glossary, ports, and EnsureBox notes. See [docs/API.md](docs/API.md) and [docs/openapi.yaml](docs/openapi.yaml) for the Phase 1 contract.

## Crate layout

```
crates/box-common    path jail, bearer compare, error envelope, config
crates/box-exec      exec + files HTTP daemon
crates/box-host      identity / ready / capabilities
crates/box-desktop   Phase 2 stub (Xvfb + x11vnc + noVNC)
crates/box-chrome    Phase 2 stub (Chromium + profile)
crates/box-cua       Phase 2 stub (screenshot / click / type)
```

## Volumes

| Mount | Phase 1 |
| --- | --- |
| `/workspace` | Required. Jail root for cwd and file APIs. |
| `/home/box/chrome-profile` | Mounted as a placeholder; unused until `box-chrome`. |

## What this is not

- Not L4 / not an OpenAI-compatible inference gateway
- Not L2 box orchestration (create/stop/hibernate)
- Not a desktop or CUA product yet
- Not a re-host of any proprietary exec/sand-host binary
