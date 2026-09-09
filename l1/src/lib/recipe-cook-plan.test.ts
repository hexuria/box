import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cookSettleMode,
  foldOmniboxChords,
  prepareCookSteps,
  RAW_LAUNCH_WAIT_MS,
  RAW_PAGE_WAIT_MS,
} from "./recipe-cook-plan.ts";
import type { RecipeStepJson } from "./recipe-plan.ts";

const LOGIN_RAW: RecipeStepJson[] = [
  { op: "click", x: 539, y: 764, button: 1 },
  { op: "wait", ms: 1892 },
  { op: "key", key: "ctrl", action: "down" },
  { op: "key", key: "ctrl", action: "up" },
  { op: "key", key: "ctrl", action: "down" },
  { op: "wait", ms: 667 },
  { op: "key", key: "l", action: "down" },
  { op: "key", key: "l", action: "up" },
  { op: "key", key: "ctrl", action: "up" },
  { op: "type", text: "facebook.com" },
  { op: "key", key: "Return" },
  { op: "type", text: "user@example.com" },
  { op: "key", key: "Tab" },
  { op: "type", text: "redacted" },
  { op: "key", key: "Return" },
  { op: "wait", ms: 4920 },
  { op: "click", x: 1152, y: 159, button: 1 },
];

test("foldOmniboxChords turns ctrl down/up plus l into ctrl+l", () => {
  const folded = foldOmniboxChords(LOGIN_RAW);
  assert.equal(
    folded.filter((step) => step.op === "key" && step.key === "ctrl+l").length,
    1,
  );
  assert.equal(
    folded.some((step) => step.op === "key" && step.key === "ctrl"),
    false,
  );
  assert.equal(
    folded.some((step) => step.op === "key" && step.key === "l"),
    false,
  );
});

test("prepareCookSteps for v1 keeps teach waits, adds page wait, aims close at the X", () => {
  const prepared = prepareCookSteps(LOGIN_RAW, "v1");
  assert.deepEqual(prepared[0], { op: "click", x: 539, y: 764, button: 1 });
  assert.equal(prepared[1]?.op, "wait");
  assert.ok((prepared[1]?.ms as number) >= RAW_LAUNCH_WAIT_MS);
  assert.deepEqual(prepared[2], { op: "key", key: "ctrl+l" });
  assert.deepEqual(prepared[3], { op: "type", text: "facebook.com" });
  assert.deepEqual(prepared[4], { op: "key", key: "Return" });
  assert.deepEqual(prepared[5], { op: "wait", ms: RAW_PAGE_WAIT_MS });
  assert.deepEqual(prepared[6], { op: "type", text: "user@example.com" });
  const last = prepared[prepared.length - 1];
  assert.equal(last?.op, "click");
  assert.equal(last?.x, 1262);
  assert.equal(last?.y, 16);
  assert.equal(
    prepared.some((step) => step.op === "reset_desktop"),
    false,
  );
});

test("prepareCookSteps for v2 only folds the chord and stays compressed", () => {
  const prepared = prepareCookSteps(LOGIN_RAW, "v2");
  assert.equal(prepared.filter((step) => step.op === "wait").length, 2);
  assert.deepEqual(prepared[2], { op: "key", key: "ctrl+l" });
  const last = prepared[prepared.length - 1];
  assert.equal(last?.x, 1152);
  assert.equal(last?.y, 159);
  assert.equal(cookSettleMode("v1"), "raw");
  assert.equal(cookSettleMode("v3"), "compressed");
});

test("v1 v2 v3 cook plans emit ctrl+l as one key without down/up", () => {
  for (const version of ["v1", "v2", "v3"] as const) {
    const prepared = prepareCookSteps(LOGIN_RAW, version);
    const keys = prepared.filter((step) => step.op === "key");
    assert.ok(keys.some((step) => step.key === "ctrl+l" && step.action == null));
    assert.equal(
      keys.some((step) => step.key === "ctrl" || step.key === "l"),
      false,
      version,
    );
  }
});
