# Request processing

How a call moves through grok-box. Inference is out of scope (not this repo).

## Connect

The caller already has three values from **their** orchestrator:

1. `execUrl` — published `box-exec` base (`http://127.0.0.1:1337` under Compose)
2. `hostUrl` — published `box-host` base
3. `token` — the `BOX_TOKEN` they injected at container start

`GrokBox.connect(execUrl, hostUrl, token)` stores those. It does not start Docker. It does not replace them with `/v1/info.endpoints`.

## Unauthenticated probes

| Request | Process | Meaning |
| --- | --- | --- |
| `GET {execUrl}/v1/health` | box-exec | Process is alive |
| `GET {hostUrl}/v1/health` | box-host | Process is alive |
| `GET {hostUrl}/v1/ready` | box-host | Exec health OK, and X up when `BOX_DESKTOP_REQUIRED=1` |

Compose healthcheck is `/v1/ready` on 1340. Chrome is not required for ready.

## Authenticated calls

All other routes require `Authorization: Bearer <token>`.

box-host uses `BOX_HOST_TOKEN` if set, otherwise `BOX_TOKEN`.

Failures use a single JSON envelope:

```json
{ "error": { "code": "unauthorized", "message": "missing or invalid bearer token", "status": 401 } }
```

CORS is not permissive. Server-to-server callers are unaffected. Browsers only get ACAO headers when `BOX_CORS_ORIGINS` lists their origin.

## Exec (`POST /v1/exec`)

1. Jail-check `cwd` under `WORKSPACE_ROOT`.
2. Spawn argv or `/bin/sh -c`.
3. Strip `BOX_TOKEN`, `BOX_HOST_TOKEN`, and `BOX_VNC_PASSWORD` from the child (including caller-supplied `env`).
4. Write `stdin` if provided, then close the pipe so the child sees EOF.
5. Cap stdout/stderr (`BOX_MAX_OUTPUT_BYTES`).
6. On timeout: kill the process group, **keep** whatever output was captured, `timed_out: true`, `exit_code: null`.

## Files

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/v1/files?path=` | File content or directory listing |
| PUT | `/v1/files` | Write file (`create_dirs` default true) |
| DELETE | `/v1/files?path=` | Delete file or directory (`recursive=true` for trees) |
| POST | `/v1/files/mkdir` | Create directory (`parents` default true) |

Every path is jail-checked. The workspace root cannot be overwritten or deleted.

## CUA (`POST /v1/cua/*`)

Actuators talk to `DISPLAY=:1` (1280×800, origin top-left). Out-of-range coordinates → `400 out_of_range`.

| Verb | Notes |
| --- | --- |
| `screenshot` | JSON base64 PNG, or raw `image/png` (`Accept: image/png` or `?format=png`) |
| `click` | Move + button |
| `double-click` | Move + two clicks |
| `move` | Hover; no button |
| `drag` | Mouse down at (x1,y1), move to (x2,y2), mouse up |
| `type` | xdotool type (short key delay) |
| `key` | xdotool keysym |
| `scroll` | Move, then wheel repeats in one xdotool invocation |

## Host inventory

`GET /v1/info` (bearer) returns box id, capability flags, workspace path, and **container-local** endpoint URLs (`scope: container-local`). Use it to see whether desktop/chrome/CUA are up. Do not dial those URLs from another machine; dial the URLs you published.

`GET /v1/desktop` and `GET /v1/chrome` are the same: status inside the guest. Viewer and CDP addresses are loopback unless you published noVNC (6080) yourself.

## Demo proxy (EnsureBox)

When the EnsureBox demo is running, L1 sends `ENSUREBOX_TOKEN` to `http://127.0.0.1:43142/api/v1/boxes/:id/...`. EnsureBox looks up the guest token and calls the TypeScript `grok-box` SDK with the **published** host ports. The guest token never appears in L1.
