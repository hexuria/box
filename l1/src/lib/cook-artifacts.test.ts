import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COOK_ARTIFACT_ROOT,
  artifactFileUrl,
  artifactsFromReceipt,
  cookArtifactDir,
  cookArtifactMime,
  isCookArtifactPath,
  pngsToPersist,
} from "./cook-artifacts.ts";

test("isCookArtifactPath only allows .l1/cooks files", () => {
  assert.equal(isCookArtifactPath(".l1/cooks/abc/end.png"), true);
  assert.equal(isCookArtifactPath("/workspace/.l1/cooks/abc/cook.mp4"), true);
  assert.equal(isCookArtifactPath(".l1/cooks"), false);
  assert.equal(isCookArtifactPath("notes/secret.png"), false);
  assert.equal(isCookArtifactPath(".l1/cooks/../passwd"), false);
});

test("cookArtifactDir stays under the cooks root", () => {
  assert.equal(cookArtifactDir("run-1"), `${COOK_ARTIFACT_ROOT}/run-1`);
  assert.equal(cookArtifactDir("a/../b"), `${COOK_ARTIFACT_ROOT}/ab`);
});

test("artifactFileUrl is an L1 session path, not a guest bind", () => {
  const url = artifactFileUrl("box1", "/workspace/.l1/cooks/r/end.png");
  assert.match(url, /^\/api\/boxes\/box1\/files\/raw\?path=/);
  assert.doesNotMatch(url, /1337|1340|novnc/i);
  assert.equal(cookArtifactMime("end.png"), "image/png");
  assert.equal(cookArtifactMime("cook.mp4"), "video/mp4");
});

test("artifactsFromReceipt prefers guest file paths over inline png", () => {
  const artifacts = artifactsFromReceipt({
    screenshot: {
      path: "/workspace/.l1/cooks/r/end.png",
      width: 1280,
      height: 800,
      bytes: 12,
    },
    artifacts: [
      {
        kind: "recording",
        label: "cook",
        path: "/workspace/.l1/cooks/r/cook.mp4",
        mime: "video/mp4",
        bytes: 99,
      },
    ],
  });
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0]?.kind, "recording");
  assert.equal(artifacts[1]?.kind, "screenshot");
});

test("pngsToPersist skips shots that already have a guest path", () => {
  const pending = pngsToPersist({
    screenshot: {
      png_base64: "aaa",
      path: "/workspace/.l1/cooks/r/end.png",
    },
    steps: [{ index: 0, screenshot: { png_base64: "bbb" } }],
  });
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.name, "step-00.png");
});
