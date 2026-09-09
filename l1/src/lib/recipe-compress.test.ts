import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TEACH_WAIT_CAP_MS,
  TEACH_WAIT_KEEP_MIN_MS,
  compressRecipeSteps,
} from "./recipe-compress.ts";
import type { RecipeStepJson } from "./recipe-plan.ts";

/** Uriah's Teach-a-task recording: type fragments, waits, and BackSpace spam. */
const URIAH_RAW: RecipeStepJson[] = [
  { op: "click", x: 36, y: 772, button: 1 },
  { op: "wait", ms: 1400 },
  { op: "key", key: "ctrl+l" },
  { op: "wait", ms: 520 },
  { op: "type", text: "g" },
  { op: "wait", ms: 910 },
  { op: "type", text: "oo" },
  { op: "wait", ms: 1965 },
  { op: "type", text: "gle.com" },
  { op: "wait", ms: 800 },
  { op: "key", key: "Return" },
  { op: "wait", ms: 2200 },
  { op: "key", key: "ctrl+l" },
  { op: "wait", ms: 410 },
  { op: "type", text: "you" },
  { op: "wait", ms: 700 },
  { op: "type", text: "tube.com" },
  { op: "wait", ms: 640 },
  { op: "key", key: "Return" },
  { op: "wait", ms: 1965 },
  { op: "click", x: 512, y: 184, button: 1 },
  { op: "wait", ms: 910 },
  { op: "type", text: "kas" },
  { op: "type", text: "bisd" },
  { op: "key", key: "BackSpace" },
  { op: "key", key: "BackSpace" },
  { op: "key", key: "BackSpace" },
  { op: "key", key: "BackSpace" },
  { op: "wait", ms: 500 },
  { op: "key", key: "BackSpace" },
  { op: "wait", ms: 400 },
  { op: "key", key: "BackSpace" },
  { op: "type", text: "abisado" },
  { op: "wait", ms: 720 },
  { op: "key", key: "Return" },
  { op: "wait", ms: 910 },
  { op: "click", x: 400, y: 300, button: 1 },
  { op: "wait", ms: 1100 },
  { op: "scroll", x: 640, y: 400, dx: 0, dy: 120 },
];

const URIAH_COMPRESSED: RecipeStepJson[] = [
  { op: "click", x: 36, y: 772, button: 1 },
  { op: "key", key: "ctrl+l" },
  { op: "type", text: "google.com" },
  { op: "key", key: "Return" },
  { op: "key", key: "ctrl+l" },
  { op: "type", text: "youtube.com" },
  { op: "key", key: "Return" },
  { op: "wait", ms: TEACH_WAIT_CAP_MS },
  { op: "click", x: 512, y: 184, button: 1 },
  { op: "type", text: "kabisado" },
  { op: "key", key: "Return" },
  { op: "wait", ms: TEACH_WAIT_CAP_MS },
  { op: "click", x: 400, y: 300, button: 1 },
  { op: "scroll", x: 640, y: 400, dx: 0, dy: 120 },
];

test("merges type fragments separated by waits into one string", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "type", text: "g" },
      { op: "wait", ms: 910 },
      { op: "type", text: "oo" },
      { op: "wait", ms: 1965 },
      { op: "type", text: "gle.com" },
    ]),
    [{ op: "type", text: "google.com" }],
  );
});

test("applies BackSpace across type fragments to rebuild the string", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "type", text: "kas" },
      { op: "type", text: "bisd" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "BackSpace" },
      { op: "wait", ms: 500 },
      { op: "key", key: "BackSpace" },
      { op: "wait", ms: 400 },
      { op: "key", key: "BackSpace" },
      { op: "type", text: "abisado" },
    ]),
    [{ op: "type", text: "kabisado" }],
  );
});

test("applies Delete like BackSpace using UTF-16 code units", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "type", text: "ab" },
      { op: "key", key: "Delete" },
      { op: "type", text: "c" },
    ]),
    [{ op: "type", text: "ac" }],
  );
});

test("does not merge type steps across key Return", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "type", text: "google.com" },
      { op: "key", key: "Return" },
      { op: "type", text: "youtube.com" },
    ]),
    [
      { op: "type", text: "google.com" },
      { op: "key", key: "Return" },
      { op: "type", text: "youtube.com" },
    ],
  );
});

test("flushes type before Tab click drag scroll and chords", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "type", text: "a" },
      { op: "key", key: "Tab" },
      { op: "type", text: "b" },
      { op: "click", x: 1, y: 2, button: 1 },
      { op: "type", text: "c" },
      { op: "drag", x1: 1, y1: 1, x2: 2, y2: 2, button: 1 },
      { op: "type", text: "d" },
      { op: "scroll", x: 3, y: 4, dx: 0, dy: 120 },
      { op: "type", text: "e" },
      { op: "key", key: "ctrl+l" },
      { op: "type", text: "f" },
    ]),
    [
      { op: "type", text: "a" },
      { op: "key", key: "Tab" },
      { op: "type", text: "b" },
      { op: "click", x: 1, y: 2, button: 1 },
      { op: "type", text: "c" },
      { op: "drag", x1: 1, y1: 1, x2: 2, y2: 2, button: 1 },
      { op: "type", text: "d" },
      { op: "scroll", x: 3, y: 4, dx: 0, dy: 120 },
      { op: "type", text: "e" },
      { op: "key", key: "ctrl+l" },
      { op: "type", text: "f" },
    ],
  );
});

test("drops empty type after backspacing the whole buffer", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "type", text: "ab" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "Return" },
    ]),
    [{ op: "key", key: "Return" }],
  );
});

test("emits leftover BackSpace when erasing past empty with no following type", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "type", text: "a" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "Return" },
    ]),
    [
      { op: "key", key: "BackSpace" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "Return" },
    ],
  );
});

test("emits leftover BackSpace then following type in the same run", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "type", text: "a" },
      { op: "key", key: "BackSpace" },
      { op: "key", key: "BackSpace" },
      { op: "type", text: "z" },
    ]),
    [{ op: "key", key: "BackSpace" }, { op: "type", text: "z" }],
  );
});

test("drops thinking waits before type and between waits", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "wait", ms: 900 },
      { op: "type", text: "hi" },
      { op: "wait", ms: 400 },
      { op: "wait", ms: 800 },
      { op: "key", key: "Return" },
      { op: "wait", ms: 500 },
    ]),
    [{ op: "type", text: "hi" }, { op: "key", key: "Return" }],
  );
});

test("drops wait after Return when the next step is type or a chord", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "key", key: "Return" },
      { op: "wait", ms: 900 },
      { op: "type", text: "next" },
      { op: "key", key: "Return" },
      { op: "wait", ms: 900 },
      { op: "key", key: "ctrl+l" },
    ]),
    [
      { op: "key", key: "Return" },
      { op: "type", text: "next" },
      { op: "key", key: "Return" },
      { op: "key", key: "ctrl+l" },
    ],
  );
});

test("keeps one capped wait after Return before click when pause is at least 400ms", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "key", key: "Return" },
      { op: "wait", ms: 200 },
      { op: "wait", ms: 2000 },
      { op: "click", x: 10, y: 20, button: 1 },
    ]),
    [
      { op: "key", key: "Return" },
      { op: "wait", ms: TEACH_WAIT_CAP_MS },
      { op: "click", x: 10, y: 20, button: 1 },
    ],
  );
});

test("keeps wait after Return before scroll without exceeding the cap", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "key", key: "Return" },
      { op: "wait", ms: 450 },
      { op: "scroll", x: 1, y: 2, dx: 0, dy: 120 },
    ]),
    [
      { op: "key", key: "Return" },
      { op: "wait", ms: 450 },
      { op: "scroll", x: 1, y: 2, dx: 0, dy: 120 },
    ],
  );
});

test("drops wait after Return before click when pause is under 400ms", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "key", key: "Return" },
      { op: "wait", ms: TEACH_WAIT_KEEP_MIN_MS - 1 },
      { op: "click", x: 1, y: 2, button: 1 },
    ]),
    [
      { op: "key", key: "Return" },
      { op: "click", x: 1, y: 2, button: 1 },
    ],
  );
});

test("drops wait after click before scroll", () => {
  assert.deepEqual(
    compressRecipeSteps([
      { op: "click", x: 1, y: 2, button: 1 },
      { op: "wait", ms: 900 },
      { op: "scroll", x: 3, y: 4, dx: 0, dy: 120 },
    ]),
    [
      { op: "click", x: 1, y: 2, button: 1 },
      { op: "scroll", x: 3, y: 4, dx: 0, dy: 120 },
    ],
  );
});

test("does not mutate the raw v1 input array or step objects", () => {
  const raw: RecipeStepJson[] = [
    { op: "type", text: "g" },
    { op: "wait", ms: 910 },
    { op: "type", text: "o" },
  ];
  const snapshot = JSON.parse(JSON.stringify(raw));
  const compressed = compressRecipeSteps(raw);
  assert.deepEqual(raw, snapshot);
  assert.equal(compressed[0]?.text, "go");
  assert.equal(raw[0]?.text, "g");
});

test("Uriah full recording compresses to the dock-search-scroll plan", () => {
  const compressed = compressRecipeSteps(URIAH_RAW);
  assert.deepEqual(compressed, URIAH_COMPRESSED);
  assert.equal(
    compressed.filter((step) => step.op === "wait").length,
    2,
  );
  assert.equal(
    URIAH_RAW.filter((step) => step.op === "wait").length,
    16,
  );
});

test("login-shaped recording emits one ctrl+l tap and drops launch and page-load waits", () => {
  const compressed = compressRecipeSteps([
    { op: "click", x: 36, y: 772, button: 1 },
    { op: "wait", ms: 1400 },
    { op: "key", key: "ctrl", action: "down" },
    { op: "key", key: "l", action: "down" },
    { op: "key", key: "l", action: "up" },
    { op: "key", key: "ctrl", action: "up" },
    { op: "wait", ms: 520 },
    { op: "type", text: "https://example.com/login" },
    { op: "key", key: "Return" },
    { op: "wait", ms: 2200 },
    { op: "type", text: "user@example.com" },
    { op: "key", key: "Tab" },
    { op: "type", text: "redacted" },
    { op: "key", key: "Return" },
    { op: "wait", ms: 800 },
    { op: "click", x: 400, y: 300, button: 1 },
    { op: "reset_desktop" },
  ]);
  assert.deepEqual(compressed, [
    { op: "click", x: 36, y: 772, button: 1 },
    { op: "key", key: "ctrl+l" },
    { op: "type", text: "https://example.com/login" },
    { op: "key", key: "Return" },
    { op: "type", text: "user@example.com" },
    { op: "key", key: "Tab" },
    { op: "type", text: "redacted" },
    { op: "key", key: "Return" },
    { op: "wait", ms: TEACH_WAIT_CAP_MS },
    { op: "click", x: 400, y: 300, button: 1 },
    { op: "reset_desktop" },
  ]);
});
