import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuestInputQueue } from "./guest-input.ts";

test("consecutive letters coalesce; Return splits the type run", () => {
  const q = createGuestInputQueue();
  q.queueType("face");
  q.queueType("book.com");
  q.queueKey("Return");
  q.queueType("more");
  assert.deepEqual(q.takeAll(), [
    { kind: "type", text: "facebook.com" },
    { kind: "key", key: "Return" },
    { kind: "type", text: "more" },
  ]);
  assert.equal(q.hasPending(), false);
});

test("queued keys survive an in-flight pointer or modifier job", () => {
  const q = createGuestInputQueue();
  const actuatorBusy = true;
  q.queueType("hello");
  q.queueKey("Return");
  // Old drainGuest: `if (!busyRef) drain()` dropped this buffer forever.
  assert.equal(actuatorBusy, true);
  assert.equal(q.hasPending(), true);
  assert.deepEqual(q.takeAll(), [
    { kind: "type", text: "hello" },
    { kind: "key", key: "Return" },
  ]);
});

test("Ctrl+L is one combined key tap, not down/up", () => {
  const q = createGuestInputQueue();
  q.queueKey("ctrl+l");
  assert.deepEqual(q.takeAll(), [{ kind: "key", key: "ctrl+l" }]);
});

test("takeNext preserves FIFO across mixed type and chords", () => {
  const q = createGuestInputQueue();
  q.queueKey("ctrl+l");
  q.queueType("x");
  q.queueKey("Return");
  assert.deepEqual(q.takeNext(), { kind: "key", key: "ctrl+l" });
  assert.deepEqual(q.takeNext(), { kind: "type", text: "x" });
  assert.deepEqual(q.takeNext(), { kind: "key", key: "Return" });
  assert.equal(q.takeNext(), null);
});
