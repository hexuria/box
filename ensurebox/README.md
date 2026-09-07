# EnsureBox — Grok Bot Layer 2

Control plane for [grok-box](https://github.com/hexuria/box). It creates Linux guests from the `grok-box` image, holds each box token, waits until the guest is ready, and exposes an HTTP API so L1 can run shell / files / Computer Use. It does not run models (that is L4) and it is not the sandboxed computer (that is L3).

The browser UI on this app is a **thin operator console**: ports, volumes, container identity, and lifecycle. It does not include shell, files, or CUA. Those belong in [`../l1`](../l1).

The guest image is unchanged: EnsureBox lives next to it, and is not copied into the Docker image.

## Quick start

From the **repository root**, build the L3 image if you do not already have it:

```bash
docker compose build
```

Then:

```bash
cd ensurebox
cp .env.example .env
npm install
npm run dev
```

Open [http://127.0.0.1:43142](http://127.0.0.1:43142) to provision a guest, inspect host ports and volumes, and start or destroy it. Use the L1 client on [http://127.0.0.1:43141](http://127.0.0.1:43141) to work in the box.

If the Node process cannot talk to Docker, run:

```bash
sg docker -c 'npm run dev'
```

## What it does

| Action | Effect |
| --- | --- |
| **Create** | `docker run` `GROK_BOX_IMAGE`, unique host ports, volumes under `ensurebox/data/volumes/<id>/` |
| **Ready** | Poll guest `GET :1340/v1/ready` until 200 |
| **Stop** | `docker stop`, keep container + volumes |
| **Hibernate** | Stop and keep volumes (resume with **Start**) |
| **Destroy** | `docker rm -f` and delete volumes |
| **HTTP tools** | Proxy to guest `box-exec` with the stored `BOX_TOKEN` (for L1, not the operator UI) |

Published guest ports are bound to `127.0.0.1`. Raw VNC (5900) and CDP (9222) stay inside the guest.

## HTTP API (L1 wire)

Base: `http://127.0.0.1:43142`

Auth: `Authorization: Bearer <ENSUREBOX_TOKEN>` except `GET /api/v1/health`.

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
| POST | `/api/v1/boxes/:id/exec` body `{ "command": "echo ok" }` or argv |
| GET, PUT | `/api/v1/boxes/:id/files` |
| POST | `/api/v1/boxes/:id/cua/screenshot` |
| POST | `/api/v1/boxes/:id/cua/click` `{x,y,button?}` |
| POST | `/api/v1/boxes/:id/cua/type` `{text}` |
| POST | `/api/v1/boxes/:id/cua/key` `{key}` |
| POST | `/api/v1/boxes/:id/cua/scroll` `{x,y,dx,dy}` |

The operator console never sends the guest `BOX_TOKEN` to the browser. Responses omit it. VNC password is shown as a viewer password, not as a usable box credential.

## Smoke

```bash
./scripts/smoke.sh
```

Requires Docker, a `grok-box:local` (or `GROK_BOX_IMAGE`) image, and a running EnsureBox server (`npm run dev`). The script hits the HTTP API (including exec and screenshot) and checks that the dashboard HTML is not a tools UI.
