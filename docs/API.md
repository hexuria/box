# Phase 1 API contract

Base URLs (Compose defaults):

- Exec: `http://127.0.0.1:1337`
- Host: `http://127.0.0.1:1340`

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

Common codes: `unauthorized`, `invalid_request`, `path_escape`, `not_found`, `payload_too_large`, `exec_failed`, `io_error`, `internal`, `not_ready`.

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

---

## box-host `:1340`

### `GET /v1/health` (public)

```json
{ "status": "ok", "service": "box-host", "version": "0.1.0" }
```

### `GET /v1/ready` (public)

`200` when `box-exec` answers `/v1/health`. Otherwise `503` with `error.code = not_ready`.

```json
{ "status": "ready", "service": "box-host", "exec_ready": true }
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
    "desktop": false,
    "chrome": false,
    "cua": false
  },
  "endpoints": {
    "exec": "http://127.0.0.1:1337",
    "host": "http://127.0.0.1:1340"
  },
  "workspace": "/workspace"
}
```

---

## Phase 2+ (not implemented)

Documented for L2 planners. Do not call these yet.

| Method | Path | Daemon |
| --- | --- | --- |
| GET | `/v1/desktop` | box-host |
| POST | `/v1/cua/screenshot` | box-exec |
| POST | `/v1/cua/click` | box-exec |
| POST | `/v1/cua/type` | box-exec |
| GET | `/v1/cua/display` | box-exec |
