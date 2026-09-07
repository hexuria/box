# Startup

How to bring grok-box up and talk to it. The product is the guest image plus HTTP, CLI, and SDKs. EnsureBox and L1 are optional demos.

## 1. Guest (required)

From the repository root:

```bash
cp .env.example .env          # optional; default BOX_TOKEN=dev-box-token
docker compose up --build
```

Wait until host ready is 200:

```bash
curl -fsS http://127.0.0.1:1340/v1/ready
```

Compose healthcheck uses the same path.

You now have:

| URL | Service |
| --- | --- |
| `http://127.0.0.1:1337` | box-exec |
| `http://127.0.0.1:1340` | box-host |
| `http://127.0.0.1:6080/vnc.html` | noVNC |

Token: `BOX_TOKEN` from `.env` (default `dev-box-token`).

### Talk HTTP

```bash
curl -fsS http://127.0.0.1:1337/v1/exec \
  -H "Authorization: Bearer dev-box-token" \
  -H "Content-Type: application/json" \
  -d '{"command":["echo","ok"]}'
```

See [API.md](API.md) for files and CUA.

### CLI

```bash
cargo run -p grok-box -- \
  --exec-url http://127.0.0.1:1337 \
  --host-url http://127.0.0.1:1340 \
  --token dev-box-token \
  ready

cargo run -p grok-box -- \
  --exec-url http://127.0.0.1:1337 \
  --host-url http://127.0.0.1:1340 \
  --token dev-box-token \
  exec -- echo ok
```

Environment aliases: `GROK_BOX_EXEC_URL`, `GROK_BOX_HOST_URL`, `GROK_BOX_TOKEN`.

### SDKs

Connect-only. Your process already knows the URLs (Compose published ports, or whatever your orchestrator mapped).

TypeScript (workspace package `sdk/typescript`):

```ts
import { GrokBox } from "grok-box";

const box = GrokBox.connect(
  "http://127.0.0.1:1337",
  "http://127.0.0.1:1340",
  "dev-box-token",
);
await box.exec({ command: ["echo", "ok"] });
```

Python (`sdk/python`):

```python
from grok_box import GrokBox

box = GrokBox.connect(
    "http://127.0.0.1:1337",
    "http://127.0.0.1:1340",
    "dev-box-token",
)
box.exec(command=["echo", "ok"])
```

Rust (`crates/grok-box`):

```rust
let box_client = grok_box::GrokBox::connect(
    "http://127.0.0.1:1337",
    "http://127.0.0.1:1340",
    "dev-box-token",
);
```

There is no `Sandbox.create()`. Start the guest with Docker (or your own runtime), then connect.

## 2. Native daemons (no desktop)

```bash
./scripts/run-local.sh
```

Binds exec/host without Xvfb. CUA will not screenshot. Smoke: `./scripts/smoke-native.sh`.

## 3. Demos (optional)

Not part of the supported product. Ports are uncommon on purpose.

**EnsureBox** (demo orchestrator) on **43142**:

```bash
cd ensurebox
cp .env.example .env
npm install
npm run dev
```

Needs a built `grok-box:local` image (`docker compose build` from the repo root). It `docker run`s guests, stores `BOX_TOKEN`, and proxies tools. The operator UI is ports/volumes/lifecycle only — no Screenshot or Shell tab.

**L1** (demo human workspace) on **43141**:

```bash
cd l1
cp .env.example .env
npm install
npm run dev
```

L1 uses `ENSUREBOX_TOKEN` only. It must not call guest binds or read `BOX_TOKEN`.

## 4. Your own orchestrator

1. `docker run` (or equivalent) from this image.
2. Inject `BOX_TOKEN`, `BOX_ID`, desktop/chrome/CUA env as needed.
3. Publish 1337, 1340, 6080 on addresses you control. Never 5900/9222.
4. Poll `GET {hostUrl}/v1/ready` until 200.
5. `GrokBox.connect(execUrl, hostUrl, token)` — the URLs **you** published, not `/v1/info`.

## Smoke

| Script | What it proves |
| --- | --- |
| `./scripts/smoke.sh` | Image build, ready, exec, files, CUA, auth |
| `./scripts/smoke-native.sh` | Host binaries without Docker |
| `ensurebox/scripts/smoke.sh` | Demo API + thin operator UI |
| `l1/scripts/smoke.sh` | L1 has no guest bind / `BOX_TOKEN` |
