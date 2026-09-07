# L1 (demo)

Sample human UI for [grok-box](https://github.com/hexuria/box): workspaces with shell, files, and desktop. It is a **demo**, not part of the guest image.

L1 talks **only** to the [EnsureBox](../ensurebox) demo over HTTP. It never SSHes, never calls `box-exec` / `box-host`, and never holds a guest `BOX_TOKEN`.

The supported way to drive a guest from your own software is the `grok-box` CLI or SDKs (`connect(execUrl, hostUrl, token)`), after **your** orchestrator starts the container.

This app is not an operator console: ports, volumes, and destroy/hibernate live on EnsureBox.

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
# L1_TOKEN for the human session; ENSUREBOX_TOKEN server-side only (must match L2)
npm install
npm run dev
```

Open [http://127.0.0.1:43141](http://127.0.0.1:43141) and sign in with `L1_TOKEN`. Create a workspace, run a command, read/write a file, or take a screenshot. All of those requests go to EnsureBox at `http://127.0.0.1:43142`. The browser never receives `ENSUREBOX_TOKEN` or a guest token.

## What it does

| Action | EnsureBox call |
| --- | --- |
| List / create | `GET` / `POST /api/v1/boxes` |
| Wake | `POST /api/v1/boxes/:id/start` |
| Shell | `POST /api/v1/boxes/:id/exec` |
| Files | `GET` / `PUT /api/v1/boxes/:id/files` |
| Computer use | `POST /api/v1/boxes/:id/cua/*` including `cua/recipe` |

Auth: pages and server actions require `L1_TOKEN` (httpOnly cookie after login). The L1 server calls EnsureBox with `Authorization: Bearer <ENSUREBOX_TOKEN>`. That token belongs to the demo L2 API, not to a guest, and is never sent to the browser.

Desktop is screenshots through EnsureBox CUA. L1 does not link guest noVNC ports or show a VNC password.

The Recipe tab runs a multi-step CUA plan as one HTTP call through EnsureBox (`POST /api/v1/boxes/:id/cua/recipe`). The browser never talks to the guest. The guest image must include that route: rebuild with `docker compose build` or EnsureBox create will start an old `grok-box:local` without `/v1/cua/recipe`.

## Environment

| Variable | Default | Meaning |
| --- | --- |
| `ENSUREBOX_URL` | `http://127.0.0.1:43142` | Demo L2 base URL |
| `ENSUREBOX_TOKEN` | required | Server-side Bearer token for EnsureBox |
| `ENSUREBOX_ALLOW_INSECURE_DEV` | unset | `1` allows the well-known/short EnsureBox token locally |
| `L1_TOKEN` | required | Human login for this UI |
| `L1_ALLOW_INSECURE_DEV` | unset | `1` allows the well-known/short L1 token locally |

## Smoke

With L1 and EnsureBox both running:

```bash
./scripts/smoke.sh
```

The script asserts L1 source never mentions `BOX_TOKEN`, guest binds `:1337` / `:1340`, `vncPassword`, or a raw 6080 password UI. Unauthenticated HTML is a login page.
