# grok-box API contract

Base URLs (Compose defaults):

- Exec: `http://127.0.0.1:1337`
- Host: `http://127.0.0.1:1340`
- Desktop viewer: `http://127.0.0.1:6080/vnc.html`

Machine-readable spec: [openapi.yaml](openapi.yaml).

Auth: `Authorization: Bearer <BOX_TOKEN>` unless noted. Errors:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "missing or invalid bearer token",
    "status": 401
  }
}
```

Common codes: `unauthorized`, `invalid_request`, `path_escape`, `not_found`, `payload_too_large`, `exec_failed`, `io_error`, `internal`, `not_ready`, `cua_disabled`, `display_unavailable`, `out_of_range`, `cua_backend`.

CUA coordinate space is the X framebuffer **1280×800** (`BOX_DISPLAY_GEOM=1280x800x24`). Origin is top-left. Clicks outside that range return `400 out_of_range`.

---

## box-exec `:1337`

### `GET /v1/health` (public)

```json
{ "status": "ok", "service": "box-exec", "version": "0.1.0" }
```

### `POST /v1/exec`

Run a process. `cwd` defaults to the workspace root and is jail-checked.

```json
{
  "command": ["echo", "ok"],
  "cwd": "",
  "timeout_ms": 30000,
  "env": { "FOO": "bar" },
  "stdin": null
}
```

`command` may also be a shell string: `"echo ok"` → `/bin/sh -c 'echo ok'`.

```json
{
  "stdout": "ok\n",
  "stderr": "",
  "exit_code": 0,
  "timed_out": false,
  "duration_ms": 4,
  "truncated": false,
  "cwd": "/workspace"
}
```

On timeout: `timed_out: true`, `exit_code: null`, process group is killed. Output streams are capped (`BOX_MAX_OUTPUT_BYTES`, default 8 MiB); `truncated` is true if a cap hit.

Default timeout 30s; max 10 minutes (`BOX_DEFAULT_TIMEOUT_MS`, `BOX_MAX_TIMEOUT_MS`).

### `GET /v1/files?path=&encoding=`

`path` is relative to `/workspace` or an absolute path under it. Empty `path` lists the workspace root.

File:

```json
{
  "kind": "file",
  "path": "/workspace/notes.txt",
  "size": 5,
  "encoding": "utf8",
  "content": "hello"
}
```

Directory:

```json
{
  "kind": "directory",
  "path": "/workspace",
  "entries": [{ "name": "notes.txt", "kind": "file", "size": 5 }]
}
```

`encoding=utf8` (default) or `base64`. Invalid UTF-8 files are returned as `base64`.

### `PUT /v1/files`

```json
{
  "path": "notes/hello.txt",
  "content": "hello",
  "encoding": "utf8",
  "create_dirs": true
}
```

```json
{ "path": "/workspace/notes/hello.txt", "bytes_written": 5 }
```

Max size: `BOX_MAX_FILE_BYTES` (default 10 MiB).

### `POST /v1/cua/screenshot`

Capture the root window of `BOX_DISPLAY` as PNG. Response is JSON (not a raw image) so L2 can log metadata without special content types.

```json
{
  "encoding": "base64",
  "mime": "image/png",
  "width": 1280,
  "height": 800,
  "bytes": 41200,
  "png_base64": "iVBORw0KGgo..."
}
```

`503 cua_disabled` if `BOX_CUA=0`. `503 display_unavailable` if Xvfb is down. `502 cua_backend` if `import`/`scrot` fail.

### `POST /v1/cua/click`

```json
{ "x": 640, "y": 400, "button": 1 }
```

`button` is optional (default 1 = left; X buttons 1–7). `200 {"ok": true}`.

### `POST /v1/cua/type`

```json
{ "text": "hello" }
```

Typed via xdotool. Rejects empty or oversized payloads.

### `POST /v1/cua/key`

```json
{ "key": "Return" }
```

`key` is an xdotool keysym (`Return`, `Tab`, `ctrl+c`, …). Whitespace and `;` are rejected.

### `POST /v1/cua/scroll`

```json
{ "x": 640, "y": 400, "dx": 0, "dy": 3 }
```

Moves to `(x,y)` then emits wheel clicks. Positive `dy` scrolls down; negative up. `dx` is horizontal. At least one of `dx`/`dy` must be non-zero.

---

## box-host `:1340`

### `GET /v1/health` (public)

```json
{ "status": "ok", "service": "box-host", "version": "0.1.0" }
```

### `GET /v1/ready` (public)

`200` when `box-exec` answers `/v1/health`, and (when `BOX_DESKTOP_REQUIRED=1`) the X display is up. Otherwise `503` with `error.code = not_ready`. Chrome is not required for ready.

```json
{ "status": "ready", "service": "box-host", "exec_ready": true, "desktop_ready": true }
```

### `GET /v1/info` (bearer)

Uses `BOX_HOST_TOKEN` if set, else `BOX_TOKEN`.

```json
{
  "box_id": "local-dev",
  "service": "box-host",
  "protocol": "v1",
  "version": {
    "box_host": "0.1.0",
    "box_exec": "0.1.0",
    "protocol": "v1"
  },
  "capabilities": {
    "exec": true,
    "files": true,
    "desktop": true,
    "chrome": true,
    "cua": true
  },
  "endpoints": {
    "exec": "http://127.0.0.1:1337",
    "host": "http://127.0.0.1:1340"
  },
  "workspace": "/workspace"
}
```

### `GET /v1/desktop` (bearer)

```json
{
  "available": true,
  "display": ":1",
  "geometry": "1280x800x24",
  "vnc": "127.0.0.1:5900",
  "viewer": {
    "port": 6080,
    "path": "/vnc.html",
    "url": "http://127.0.0.1:6080/vnc.html"
  }
}
```

Connect to `viewer.url`. VNC password = first 8 characters of `BOX_TOKEN` (or `BOX_VNC_PASSWORD`). RFB is localhost-only inside the container; Compose maps 6080.

### `GET /v1/chrome` (bearer)

```json
{
  "enabled": true,
  "running": true,
  "profile": "/home/box/chrome-profile",
  "cdp": "127.0.0.1:9222",
  "display": ":1"
}
```

CDP is loopback-only. Agents inside the box may attach; do not publish 9222.
