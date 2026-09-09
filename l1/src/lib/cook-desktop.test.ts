import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dockerfile = readFileSync(join(root, "docker/Dockerfile"), "utf8");
const reset = readFileSync(join(root, "docker/box-reset-desktop.sh"), "utf8");
const tools = readFileSync(join(root, "l1/src/components/box-tools.tsx"), "utf8");
const panel = readFileSync(join(root, "l1/src/components/recipe-panel.tsx"), "utf8");

test("guest image includes ffmpeg and box-reset-desktop", () => {
  assert.match(dockerfile, /box-reset-desktop\.sh/);
  assert.match(dockerfile, /\bffmpeg\b/);
  assert.match(dockerfile, /\bwmctrl\b/);
});

test("reset_desktop closes windows without docker restart", () => {
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

test("Desktop stays mounted when Recipe is open", () => {
  assert.match(tools, /data-desktop-keepalive/);
  assert.match(tools, /left-\[-1600px\]/);
  assert.doesNotMatch(tools, /<TabsContent value="cua"/);
  assert.match(tools, /TabsContent value="recipe"[^>]*keepMounted/);
});

test("Recipe panel records cook from step 0 when enabled", () => {
  assert.match(panel, /Record cook/);
  assert.match(panel, /record: recordCook/);
  assert.match(panel, /CookArtifactGallery/);
  assert.match(panel, /reset_desktop/);
});
