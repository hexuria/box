import assert from "node:assert/strict";
import { test } from "node:test";
import { loopbackConnectHost, matchEnsureboxVncPath } from "./vnc-path.ts";

test("matchEnsureboxVncPath extracts the box id", () => {
  assert.equal(matchEnsureboxVncPath("/api/v1/boxes/abc123/vnc"), "abc123");
  assert.equal(matchEnsureboxVncPath("/api/v1/boxes/abc123/vnc?x=1"), "abc123");
  assert.equal(matchEnsureboxVncPath("/api/v1/boxes/abc123/vnc/"), "abc123");
  assert.equal(matchEnsureboxVncPath("/api/v1/boxes/abc123/cua/screenshot"), null);
  assert.equal(matchEnsureboxVncPath("/api/v1/boxes/abc123"), null);
});

test("loopbackConnectHost rewrites wildcard binds", () => {
  assert.equal(loopbackConnectHost("0.0.0.0"), "127.0.0.1");
  assert.equal(loopbackConnectHost("127.0.0.1"), "127.0.0.1");
});
