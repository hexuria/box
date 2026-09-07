# Grok Box — Layer 1 client

Human UI for [grok-box](https://github.com/hexuria/box): workspaces with shell, files, and desktop. It talks **only** to [EnsureBox](../ensurebox) over HTTP. It never SSHes, never calls `box-exec` / `box-host`, and never holds a guest `BOX_TOKEN`.

This app is not copied into the grok-box Docker image. It is not an operator console: ports, volumes, and destroy/hibernate live on EnsureBox.

## Quick start

EnsureBox must already be running (and the `grok-box:local` image built):

```bash
cd ensurebox
cp .env.example .env
npm install
npm run dev
```

Then in another terminal:

```bash
cd l1
cp .env.example .env
npm install
npm run dev
```

Open [http://127.0.0.1:43141](http://127.0.0.1:43141). Create a workspace, run a command, read/write a file, take a screenshot, or open the live desktop. All of those requests go to EnsureBox at `http://127.0.0.1:43142`.

## What it does

| Action | EnsureBox call |
| --- | --- |
| List / create | `GET` / `POST /api/v1/boxes` |
| Wake | `POST /api/v1/boxes/:id/start` |
| Shell | `POST /api/v1/boxes/:id/exec` |
| Files | `GET` / `PUT /api/v1/boxes/:id/files` |
| Computer use | `POST /api/v1/boxes/:id/cua/*` |

Auth: `Authorization: Bearer <ENSUREBOX_TOKEN>` (default `dev-ensurebox-token`). That token belongs to L2, not to a guest.

The optional “Open live desktop” link uses the noVNC URL EnsureBox published. The L1 server does not fetch that URL.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ENSUREBOX_URL` | `http://127.0.0.1:43142` | L2 base URL |
| `ENSUREBOX_TOKEN` | `dev-ensurebox-token` | Bearer token for EnsureBox |

## Smoke

With L1 and EnsureBox both running:

```bash
./scripts/smoke.sh
```
