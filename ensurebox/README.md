# EnsureBox (demo)

Sample orchestrator for [grok-box](https://github.com/hexuria/box). It is **not** a supported production control plane. The product is the guest image, CLI, and SDKs; this app shows one way to start a guest and proxy HTTP.

EnsureBox creates Linux guests from the `grok-box` image, holds each box token, waits until the guest is ready, and exposes `/api/v1` so the L1 demo can run shell / files / Computer Use. Guest calls go through the TypeScript `grok-box` SDK (`connect(execUrl, hostUrl, token)`). This app does not run models.

The browser UI is a **thin operator console**: ports, volumes, container identity, and lifecycle. It does not include shell, files, or CUA. Those belong in the L1 demo (`../l1`) or in your own client using the SDK directly.

EnsureBox is not copied into the grok-box Docker image.

## Quick start

From the **repository root**, build the guest image if you do not already have it:

```bash
docker compose build
```

Then:

```bash
cd ensurebox
cp .env.example .env
# ENSUREBOX_TOKEN is required. The example uses a well-known value with
# ENSUREBOX_ALLOW_INSECURE_DEV=1 for loopback only.
npm install
npm run dev
```

Open [http://127.0.0.1:43142](http://127.0.0.1:43142), sign in with `ENSUREBOX_TOKEN`, then provision a guest. Use the L1 demo on [http://127.0.0.1:43141](http://127.0.0.1:43141) to work in the box, or call the guest with the `grok-box` CLI / SDK using the published URLs and token **you** injected.

If the Node process cannot talk to Docker, add your user to the `docker` group and re-login. EnsureBox does **not** fall back to `sudo`.

## What it does

| Action | Effect |
| --- | --- |
| **Create** | `docker run` `GROK_BOX_IMAGE`, unique host ports, volumes under `ensurebox/data/volumes/<id>/` |
| **Ready** | Poll guest `GET :1340/v1/ready` until 200 |
| **Stop** | `docker stop`, keep container + volumes |
| **Hibernate** | Stop and keep volumes (resume with **Start**) |
| **Destroy** | `docker rm -f` and delete volumes |
| **HTTP tools** | TypeScript SDK → guest `box-exec` with the stored `BOX_TOKEN` (for L1 / API clients, not the operator UI) |

Published guest ports are bound to `127.0.0.1`. Raw VNC (5900) and CDP (9222) stay inside the guest.

## HTTP API (demo L1 wire)

Base: `http://127.0.0.1:43142`

Auth: `Authorization: Bearer <ENSUREBOX_TOKEN>` except `GET /api/v1/health`. The operator HTML uses the same token via an httpOnly session cookie (`POST /api/session`). Unauthenticated browsers see a login page, not Docker buttons. `ENSUREBOX_TOKEN` must be set; `dev-ensurebox-token` is rejected unless `ENSUREBOX_ALLOW_INSECURE_DEV=1`.

| Method | Path |
| --- | --- |
| GET | `/api/v1/health` |
| GET, POST | `/api/v1/boxes` |
| GET, DELETE | `/api/v1/boxes/:id` |
| GET | `/api/v1/boxes/:id/ready` |
| GET | `/api/v1/boxes/:id/info` |
| POST | `/api/v1/boxes/:id/start` |
| POST | `/api/v1/boxes/:id/stop` |
| POST | `/api/v1/boxes/:id/hibernate` |
| POST | `/api/v1/boxes/:id/exec` |
| GET, PUT, DELETE | `/api/v1/boxes/:id/files` |
| POST | `/api/v1/boxes/:id/files/mkdir` |
| POST | `/api/v1/boxes/:id/cua/screenshot` |
| POST | `/api/v1/boxes/:id/cua/click` |
| POST | `/api/v1/boxes/:id/cua/double-click` |
| POST | `/api/v1/boxes/:id/cua/move` |
| POST | `/api/v1/boxes/:id/cua/drag` |
| POST | `/api/v1/boxes/:id/cua/type` |
| POST | `/api/v1/boxes/:id/cua/key` |
| POST | `/api/v1/boxes/:id/cua/scroll` |
| POST | `/api/v1/boxes/:id/cua/recipe` |

The operator console never sends the guest `BOX_TOKEN` to the browser or to L1. Public `/api/v1` box JSON omits guest bind URLs and the VNC password. After login, the operator page may show host ports/volumes and the independent VNC password (not derived from the box token). 6080 is not Bearer-authenticated.

## Smoke

```bash
./scripts/smoke.sh
```

Requires Docker as the current user, a `grok-box:local` (or `GROK_BOX_IMAGE`) image, and a running EnsureBox server (`npm run dev`). The script hits the HTTP API (including exec and screenshot), checks that HTML without a session cannot create boxes, and checks that the dashboard HTML is not a tools UI.
