# Changelog

Guest honesty and wire parity against BOX-REVIEW P0 → P1 (selective P2). Baseline `main` @ `3c67b576e2d4b67da5849b55bc2de6231d31ff47`.

## P0

| Item | Where |
| --- | --- |
| Wire truth (press/release/aliases, recipe fields, rename, desktop/chrome) | `docs/openapi.yaml`, `docs/API.md`, `README.md`, Rust CLI, TS/Python SDKs |
| Capabilities `{enabled, ready}` | `crates/box-host` `/v1/info` |
| Chrome probe via CDP `/json/version` (no `/proc` scrape) | `crates/box-chrome` |
| Unified `env_bool` | `crates/box-common/src/env.rs` |
| Recipe `settle` default **off**; no Chromium launch/close side effects | `crates/box-cua` recipe/settle |
| One Chromium model (entrypoint). `chromium-launch.sh` not in the image. `reset_desktop` does not kill Chromium | `docker/entrypoint.sh`, `docker/Dockerfile`, `docker/box-reset-desktop.sh` |
| Compose `cap_drop ALL`, `no-new-privileges`, `pids_limit`, `mem_limit` — not a kernel sandbox | `docker-compose.yml`, README |
| `BOX_MAX_CONCURRENT_EXECS` (default 8), 429 `busy`, SIGTERM then SIGKILL, `exec_id` | `crates/box-exec` |
| CI: test, clippy `-D warnings`, smoke-native, OpenAPI presence | `.github/workflows/ci.yml`, `scripts/check-openapi.sh` |
| Rust client HTTPS (hyper-rustls). Guest daemons remain HTTP; TLS is at a proxy | `crates/grok-box`, `docs/DEPLOY.md` |

## P1

| Item | Where |
| --- | --- |
| `POST /v1/exec/stream` NDJSON / SSE | `crates/box-exec` |
| PTY deferred (`pty: true` → 400) | exec request + API.md |
| Raw file GET/PUT octet-stream; listing `truncated` cap | `/v1/files/raw`, `BOX_MAX_DIR_ENTRIES` |
| `GET /v1/desktop/windows` | `crates/box-desktop` + box-host |
| `GET /v1/busy`, `POST /v1/shutdown` | box-exec + box-host |
| GHCR publish on `v*` tags | `.github/workflows/publish-image.yml` |
| `x-request-id` echo | `crates/box-common/src/request_id.rs` |

## P2 (done)

| Item | Where |
| --- | --- |
| Optional detached exec + `GET /v1/exec/{id}` | box-exec |
| `GET /v1/metrics` | box-exec + box-host |
| `BOX_DISPLAY_GEOM` already drives CUA coords; added a regression test | `crates/box-cua` |
| Did **not** vendor trycua | — |

## Deferred

- PTY exec (use `/v1/exec/stream`)
- Moving `ensurebox/` / `l1/` out of this repo (marked frozen demos / non-product)
