# Recipes (one call, many CUA steps)

This is grok-box’s custom take on [reverse-web-mcp](https://github.com/hexuria/reverse-web-mcp): **pay the model once to write a plan, then execute that plan as one guest request.**

It is **not** a fork of `rwmcp`. grok-box is the Linux **screen** (Xvfb + XTEST). reverse-web-mcp is a **compiler** for apps that publish a world model (`x-reverse-webmcp` on OpenAPI). Different layer, same idea: stop doing click → screenshot → click as N tool calls.

## What reverse-web-mcp does

- The app declares what operations *mean* (postcondition, read/write footprint, surfaces).
- A goal becomes **wants** (predicates). A compiler turns wants into a **DAG**.
- A **scheduler** runs the DAG as wide as the data allows. API effects can run in parallel. UI-only ops need a screen surface (`crates/driver`, CDP).
- A successful plan is saved as a **recipe** with `$placeholders`. Re-runs cost **zero** model calls.
- A **receipt** proves what ran (idempotency keys, no double-sends).

The measured win vs a WebMCP/MCP loop is model calls and tokens, not pixels.

## What grok-box CUA already was

Each verb is its own HTTP round trip:

`POST /v1/cua/click` then `POST /v1/cua/type` then `POST /v1/cua/key` …

That is the “agent does click/scroll on multiple requests” path. Fine when the **next** action depends on a new screenshot. Expensive when the path is already known (open URL bar, type, Return).

There was **no** preceding batch/recipe endpoint on this guest. Single-op CUA (including press / release / double-click / drag / move) is still there.

## What grok-box recipes are

`POST /v1/cua/recipe` — one Bearer call, many sequential pointer steps, one **receipt**.

```json
{
  "name": "focus-and-search",
  "stop_on_error": true,
  "screenshot": "end",
  "steps": [
    { "op": "click", "x": 640, "y": 80, "button": 1 },
    { "op": "type", "text": "https://example.com" },
    { "op": "key", "key": "Return" },
    { "op": "wait", "ms": 400 }
  ]
}
```

The guest **lints the whole plan first** (empty, >256 steps, out-of-range coordinates, bad keys). If lint fails, **nothing** moves. Then it runs in order. Default screenshot is `end` (one PNG on the receipt, and a file under `artifact_dir` when that field is set). `none` skips it. `each` attaches a PNG after every non-wait step (heavy). `settle: "raw"` waits until Chromium is mapped and the title/URL changes after Return; `compressed` uses shorter timeouts so v2/v3 stay faster. Teach `wait` steps are always honored.

`record: true` starts ffmpeg/x11grab on the same X display **before the first CUA step** (before `warmup_pointer`) and sends SIGINT after the last step so the MP4 is finalized. There is no `-t` duration cap (that is what made tapes stop at 1s). Live capture is fragmented so SIGINT can finish the file; a second pass remuxes to progressive `+faststart`. Finder, QuickTime, and Chrome play `frag_keyframe+empty_moov` x264 as a still (Play does not change pixels). Exact commands:

```bash
ffmpeg -nostdin -hide_banner -loglevel error -y \
  -f x11grab -draw_mouse 1 -video_size 1280x800 -framerate 8 -i :1.0 \
  -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -b:v 700k -maxrate 900k -bufsize 1800k \
  -movflags +frag_keyframe+empty_moov+default_base_moof \
  /workspace/.l1/cooks/<run>/cook.mp4

ffmpeg -nostdin -hide_banner -loglevel error -y \
  -i /workspace/.l1/cooks/<run>/cook.mp4 \
  -an -c:v copy -movflags +faststart \
  /workspace/.l1/cooks/<run>/cook.faststart.mp4
```

The video is a guest file (`cook.mp4`), not a new VNC session. `reset_desktop` (alias `reset`) closes Chromium, Terminal, Files, and leftover jobs via wmctrl — **same box id**, no Docker restart.

Wait is capped at 10s per step. `stop_on_error` defaults true; earlier steps stay in the receipt (`ok: false`, `stopped_at`).

CLI:

```bash
cargo run -p grok-box -- cua recipe --file plan.json
```

SDKs: `client.recipe({ steps: [...] })`. EnsureBox demo proxy: `POST /api/v1/boxes/:id/cua/recipe`.

## Honest comparison

| | reverse-web-mcp | grok-box single CUA | grok-box recipe |
| --- | --- | --- | --- |
| Who writes the plan | Compiler from wants + world model | The model, every turn | The caller (usually the model, once) |
| Model in the loop | Median 1, then 0 on `--recipe` | Every click | Not during this HTTP call |
| Parallelism | DAG of API effects | n/a | **No** — one X pointer |
| Receipt | Ledger, idempotency keys | `{ok:true}` per verb | Per-step `ok` / `ms` / optional PNG |
| Screen | Optional CDP driver | X11 1280×800 | Same X11, batched |
| WebMCP | Consumes app-published actions | Not in this repo | Not in this repo |
| When to use | Annotated business app | Next click needs a new picture | Choreography already known |

CUA cannot be a parallel DAG. Two clicks share one cursor. Recipes still win on **round trips** and **model turns** when the path does not need vision between steps.

Optional `record: true` plus `artifact_dir` writes a cook video and PNG files so a UI can show them without stuffing megabytes of base64 through the receipt. L1’s **Record cook** switch (default on) uses that. `reset_desktop` is a real step for a clean empty desktop between runs.

If the agent must look at the framebuffer after every click, keep single-op CUA (or `screenshot: "each"`, which is still one HTTP call but a large body).

## What this is not (yet)

- Not a world-model compiler. The guest does not parse wants like `invoice(customer=…).status='sent'`.
- Not WebMCP. Chromium in the guest may load a site that speaks WebMCP; grok-box does not broker those tools yet.
- Not mixed exec/files + CUA in one document. Exec and files stay their own routes. A later `/v1/recipe` could mix them; CUA stays sequential even then.

The product stay: you start the guest, `connect(execUrl, hostUrl, token)`, send a recipe.
