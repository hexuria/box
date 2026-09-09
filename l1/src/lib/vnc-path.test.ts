import assert from "node:assert/strict";
import { test } from "node:test";
import { cookieValue, ensureboxVncUrl, matchDesktopRfbPath } from "./vnc-path.ts";

test("matchDesktopRfbPath extracts the box id", () => {
  assert.equal(matchDesktopRfbPath("/api/desktop/abc123/rfb"), "abc123");
  assert.equal(matchDesktopRfbPath("/api/desktop/abc123/rfb?x=1"), "abc123");
  assert.equal(matchDesktopRfbPath("/api/cua/screenshot"), null);
});

test("ensureboxVncUrl rewrites http to ws against EnsureBox", () => {
  assert.equal(
    ensureboxVncUrl("http://127.0.0.1:43142", "abc"),
    "ws://127.0.0.1:43142/api/v1/boxes/abc/vnc",
  );
});

test("cookieValue reads a named cookie", () => {
  assert.equal(cookieValue("l1_session=secret; Path=/", "l1_session"), "secret");
  assert.equal(cookieValue("other=1", "l1_session"), null);
});
