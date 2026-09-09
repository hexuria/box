import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TYPE_IDLE_MS,
  createTypeCoalescer,
  formatLogLine,
} from "./action-log.ts";

test("coalesces characters then Return", () => {
  const coalescer = createTypeCoalescer();
  let at = 1000;
  for (const ch of "facebook.com") {
    assert.deepEqual(coalescer.pushType(ch, at), []);
    at += 20;
  }
  assert.deepEqual(coalescer.flushThen({ op: "key", key: "Return" }, at), [
    { op: "type", text: "facebook.com" },
    { op: "key", key: "Return" },
  ]);
});

test("idle pause splits type steps", () => {
  const coalescer = createTypeCoalescer();
  assert.deepEqual(coalescer.pushType("hello", 0), []);
  assert.deepEqual(coalescer.pushType("world", TYPE_IDLE_MS + 50), [
    { op: "type", text: "hello" },
  ]);
  assert.deepEqual(coalescer.flush(TYPE_IDLE_MS + 60), [
    { op: "type", text: "world" },
  ]);
});

test("idleFlush emits a type after the pause", () => {
  const coalescer = createTypeCoalescer();
  coalescer.pushType("hi", 10);
  assert.deepEqual(coalescer.idleFlush(10 + TYPE_IDLE_MS - 1), []);
  assert.deepEqual(coalescer.idleFlush(10 + TYPE_IDLE_MS), [
    { op: "type", text: "hi" },
  ]);
});

test("click flushes type without per-character steps", () => {
  const coalescer = createTypeCoalescer();
  for (const ch of "ok") {
    assert.deepEqual(coalescer.pushType(ch, 1), []);
  }
  assert.deepEqual(
    coalescer.flushThen({ op: "click", x: 640, y: 80, button: 1 }, 2),
    [
      { op: "type", text: "ok" },
      { op: "click", x: 640, y: 80, button: 1 },
    ],
  );
});

test("spaces stay in one string; Tab splits", () => {
  const coalescer = createTypeCoalescer();
  for (const ch of "hello world") {
    coalescer.pushType(ch, 1);
  }
  assert.deepEqual(coalescer.flushThen({ op: "key", key: "Tab" }, 2), [
    { op: "type", text: "hello world" },
    { op: "key", key: "Tab" },
  ]);
});

test("backspace mutates the draft until it is empty", () => {
  const coalescer = createTypeCoalescer();
  coalescer.pushType("ab", 1);
  assert.deepEqual(coalescer.backspace(2), []);
  assert.equal(coalescer.draft(), "a");
  coalescer.backspace(3);
  assert.equal(coalescer.draft(), "");
  assert.deepEqual(coalescer.backspace(4), [{ op: "key", key: "BackSpace" }]);
});

test("formatLogLine hides wait and formats actions", () => {
  assert.equal(formatLogLine({ op: "wait", ms: 400 }), null);
  assert.equal(formatLogLine({ op: "type", text: "facebook.com" }), 'type "facebook.com"');
  assert.equal(formatLogLine({ op: "key", key: "Return" }), "key Return");
  assert.equal(formatLogLine({ op: "key", key: "ctrl", action: "down" }), "key ctrl down");
  assert.equal(formatLogLine({ op: "press", x: 10, y: 20 }), "press (10, 20)");
  assert.equal(formatLogLine({ op: "click", x: 640, y: 80 }), "click (640, 80)");
  assert.equal(
    formatLogLine({ op: "click", x: 640, y: 80, button: 1 }),
    "click (640, 80)",
  );
  assert.equal(
    formatLogLine({ op: "click", x: 900, y: 400, button: 3 }),
    "click button=right (900, 400)",
  );
  assert.equal(
    formatLogLine({ op: "drag", x1: 200, y1: 200, x2: 500, y2: 400 }),
    "drag (200, 200) → (500, 400)",
  );
  assert.equal(
    formatLogLine({ op: "drag", x1: 10, y1: 10, x2: 40, y2: 40, button: 3 }),
    "drag button=right (10, 10) → (40, 40)",
  );
  assert.equal(
    formatLogLine({ op: "scroll", x: 640, y: 400, dx: 0, dy: 120 }),
    "scroll (640, 400) dy 120",
  );
});
