import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = readFileSync(join(root, "docker/entrypoint.sh"), "utf8");
const dockerfile = readFileSync(join(root, "docker/Dockerfile"), "utf8");
const lifecycle = readFileSync(join(root, "ensurebox/src/lib/lifecycle.ts"), "utf8");
const desktop = readFileSync(join(root, "l1/src/components/desktop-viewer.tsx"), "utf8");
const surface = readFileSync(join(root, "l1/src/components/vnc-surface.tsx"), "utf8");
const tools = readFileSync(join(root, "l1/src/components/box-tools.tsx"), "utf8");
const reset = readFileSync(join(root, "docker/box-reset-desktop.sh"), "utf8");

test("x11vnc uses XDAMAGE and LAN timing, not slideshow flags", () => {
  assert.match(entry, /x11vnc\s+\\/);
  assert.match(entry, /-xdamage/);
  assert.doesNotMatch(entry, /-noxriverage/);
  assert.match(entry, /-nowireframe/);
  assert.match(entry, /-speeds lan/);
  assert.match(entry, /-wait 10/);
  assert.match(entry, /-defer 5/);
  assert.doesNotMatch(entry, /-ncache/);
  assert.doesNotMatch(entry, /-threads/);
});

test("Xvfb advertises DAMAGE for x11vnc", () => {
  assert.match(entry, /\+extension DAMAGE/);
});

test("guest websockify runs with TCP_NODELAY", () => {
  assert.match(entry, /websockify-nodelay/);
  assert.match(dockerfile, /websockify-nodelay\.py/);
});

test("EnsureBox guests get /dev/shm without CPU/memory caps", () => {
  assert.match(lifecycle, /"--shm-size"/);
  assert.match(lifecycle, /"256m"/);
  assert.doesNotMatch(lifecycle, /"--memory"/);
  assert.doesNotMatch(lifecycle, /"--cpus"/);
});

test("Desktop tab does not poll CUA screenshots", () => {
  assert.doesNotMatch(desktop, /screenshotAction/);
  assert.doesNotMatch(desktop, /setInterval/);
});

test("noVNC prefers LAN quality and no extra zlib", () => {
  assert.match(surface, /qualityLevel = 6/);
  assert.match(surface, /compressionLevel = 0/);
});

test("Desktop records from noVNC mouse events, not CUA screenshot clicks", () => {
  assert.match(surface, /attachVncGuestRecorder/);
  assert.match(surface, /recordingRef\.current = recording/);
  assert.match(desktop, /recording=\{recordActions\}/);
  assert.match(desktop, /const recordActions = teaching \|\| logOpen/);
  assert.doesNotMatch(desktop, /onPointerDownCapture/);
  assert.doesNotMatch(desktop, /clickAction/);
  assert.doesNotMatch(surface, /clickAction/);
});

test("VNC stays connected when Recipe is open", () => {
  assert.doesNotMatch(surface, /if \(disabled \|\| !active\)/);
  assert.match(surface, /\[disabled, id, session\]/);
  assert.match(tools, /data-desktop-keepalive/);
  assert.match(tools, /left-\[-1600px\]/);
  assert.doesNotMatch(tools, /<TabsContent value="cua"/);
  assert.match(tools, /TabsContent value="recipe"[^>]*keepMounted/);
});

test("reset_desktop closes windows without docker restart", () => {
  assert.match(dockerfile, /box-reset-desktop\.sh/);
  assert.match(dockerfile, /\bffmpeg\b/);
  assert.match(reset, /wmctrl -ic/);
  assert.doesNotMatch(reset, /docker\s+restart/);
  const guestDaemon = ["box", "exec"].join("-");
  assert.match(reset, new RegExp(guestDaemon.replace("-", "\\-")));
  assert.doesNotMatch(reset, new RegExp(`pkill.*${guestDaemon}`));
  assert.match(reset, /entrypoint\.sh\*/);
  assert.match(reset, /websockify\*/);
  assert.match(reset, /\/proc\/\$\{ppid\}\/cmdline/);
  assert.doesNotMatch(reset, /python\|python3\|node/);
  assert.doesNotMatch(reset, /\bpgrep\b/);
  assert.match(reset, /ffmpeg\|sleep\)/);
});

test("ffmpeg starts before first CUA and stops after the last step", () => {
  const recipe = readFileSync(join(root, "crates/box-cua/src/recipe.rs"), "utf8");
  const record = readFileSync(join(root, "crates/box-cua/src/cook_record.rs"), "utf8");
  const startIdx = recipe.indexOf("start_cook_recorder");
  const warmupIdx = recipe.indexOf("warmup_pointer");
  const loopIdx = recipe.indexOf("for (index, step)");
  const stopIdx = recipe.lastIndexOf("stop_cook_recorder");
  assert.ok(startIdx > 0 && startIdx < warmupIdx);
  assert.ok(warmupIdx < loopIdx && loopIdx < stopIdx);
  assert.match(record, /-INT/);
  assert.match(record, /\+frag_keyframe\+empty_moov\+default_base_moof/);
  assert.doesNotMatch(record, /"-t",/);
  assert.doesNotMatch(record, /\+frag_keyframe\+empty_moov\+faststart/);
  assert.match(record, /ffmpeg cook recording start/);
  assert.match(record, /ffmpeg cook recording stop/);
  assert.match(record, /display_target/);
  assert.match(entry, /-display "\$\{BOX_DISPLAY\}"/);
  assert.match(record, /remux_cook_mp4/);
  assert.match(record, /\+faststart/);
  assert.match(record, /"-c:v",\s*"copy"/);
});

test("dock cook maps iconic Chromium instead of treating hide as success", () => {
  const settle = readFileSync(join(root, "crates/box-cua/src/settle.rs"), "utf8");
  const launch = readFileSync(join(root, "docker/chromium-launch.sh"), "utf8");
  const recipe = readFileSync(join(root, "crates/box-cua/src/recipe.rs"), "utf8");
  assert.match(settle, /remove,hidden/);
  assert.match(settle, /windowmap/);
  assert.match(settle, /IsViewable/);
  assert.match(settle, /--raise-or-launch/);
  assert.match(launch, /--raise-or-launch/);
  assert.match(launch, /--raise-only/);
  assert.match(recipe, /DOCK_TOGGLE_MS/);
});

test("Teach records ctrl+l as one key tap, not modifier down/up", () => {
  assert.match(desktop, /browserEventToCua\(event\)/);
  assert.match(desktop, /flushThen\(\{ op: "key", key: mapped\.key \}/);
  assert.doesNotMatch(desktop, /takeoverUsesKeyHold/);
  assert.doesNotMatch(desktop, /browserEventToCuaBare/);
  assert.doesNotMatch(desktop, /action: "down"/);
  assert.doesNotMatch(desktop, /action: "up"/);
});
