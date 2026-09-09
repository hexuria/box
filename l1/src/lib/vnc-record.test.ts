import assert from "node:assert/strict";
import { test } from "node:test";
import { FRAMEBUFFER } from "./config.ts";
import {
  attachVncGuestRecorder,
  framebufferPointFromClient,
  wheelStep,
  type VncGuestPointer,
} from "./vnc-record.ts";

function fakeCanvas(css = { left: 0, top: 0, width: 640, height: 400 }) {
  return {
    width: FRAMEBUFFER.width,
    height: FRAMEBUFFER.height,
    getBoundingClientRect() {
      return { ...css, right: css.left + css.width, bottom: css.top + css.height };
    },
  };
}

test("maps a half-scale canvas click to 1280×800 framebuffer", () => {
  const canvas = fakeCanvas();
  assert.deepEqual(framebufferPointFromClient(0, 0, canvas), { x: 0, y: 0 });
  assert.deepEqual(framebufferPointFromClient(320, 200, canvas), { x: 640, y: 400 });
  assert.deepEqual(framebufferPointFromClient(639, 399, canvas), {
    x: 1278,
    y: 798,
  });
  assert.deepEqual(framebufferPointFromClient(640, 400, canvas), {
    x: FRAMEBUFFER.width - 1,
    y: FRAMEBUFFER.height - 1,
  });
});

test("clamps points outside the canvas box", () => {
  const canvas = fakeCanvas({ left: 100, top: 50, width: 640, height: 400 });
  assert.deepEqual(framebufferPointFromClient(0, 0, canvas), { x: 0, y: 0 });
  assert.deepEqual(framebufferPointFromClient(900, 900, canvas), {
    x: FRAMEBUFFER.width - 1,
    y: FRAMEBUFFER.height - 1,
  });
});

test("wheel steps are ±120", () => {
  assert.equal(wheelStep(0), 0);
  assert.equal(wheelStep(53), 120);
  assert.equal(wheelStep(-1), -120);
});

class FakeTarget extends EventTarget {
  width = FRAMEBUFFER.width;
  height = FRAMEBUFFER.height;
  getBoundingClientRect() {
    return { left: 0, top: 0, width: FRAMEBUFFER.width, height: FRAMEBUFFER.height, right: FRAMEBUFFER.width, bottom: FRAMEBUFFER.height };
  }
}

function mouse(
  type: string,
  clientX: number,
  clientY: number,
  button = 0,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX, clientY, button, buttons: type === "mouseup" ? 0 : 1 << button });
  return event;
}

test("records down on canvas and up on window (noVNC capture overlay)", () => {
  const canvas = new FakeTarget();
  const win = new EventTarget();
  const pointers: VncGuestPointer[] = [];
  let recording = true;
  const detach = attachVncGuestRecorder(
    canvas,
    {
      recording: () => recording,
      onPointer: (event) => pointers.push(event),
      onWheel: () => {
        throw new Error("unexpected wheel");
      },
      onKeyDown: () => {
        throw new Error("unexpected key");
      },
      onKeyUp: () => {
        throw new Error("unexpected key");
      },
    },
    win,
  );

  canvas.dispatchEvent(mouse("mousedown", 100, 200, 2));
  win.dispatchEvent(mouse("mouseup", 102, 201, 2));
  assert.deepEqual(pointers, [
    { type: "down", x: 100, y: 200, button: 3 },
    { type: "up", x: 102, y: 201, button: 3 },
  ]);

  pointers.length = 0;
  recording = false;
  canvas.dispatchEvent(mouse("mousedown", 10, 10, 0));
  win.dispatchEvent(mouse("mouseup", 10, 10, 0));
  assert.deepEqual(pointers, []);

  detach();
});

test("does not preventDefault on guest mouse events", () => {
  const canvas = new FakeTarget();
  const win = new EventTarget();
  const detach = attachVncGuestRecorder(
    canvas,
    {
      recording: () => true,
      onPointer: () => {},
      onWheel: () => {},
      onKeyDown: () => {},
      onKeyUp: () => {},
    },
    win,
  );
  const down = mouse("mousedown", 40, 40, 0);
  canvas.dispatchEvent(down);
  assert.equal(down.defaultPrevented, false);
  const up = mouse("mouseup", 40, 40, 0);
  win.dispatchEvent(up);
  assert.equal(up.defaultPrevented, false);
  detach();
});

test("ignores pointer events while the log and Teach are off", () => {
  const canvas = new FakeTarget();
  const win = new EventTarget();
  const pointers: VncGuestPointer[] = [];
  const detach = attachVncGuestRecorder(
    canvas,
    {
      recording: () => false,
      onPointer: (event) => pointers.push(event),
      onWheel: () => {},
      onKeyDown: () => {},
      onKeyUp: () => {},
    },
    win,
  );
  canvas.dispatchEvent(mouse("mousedown", 8, 8, 0));
  win.dispatchEvent(mouse("mouseup", 8, 8, 0));
  assert.equal(pointers.length, 0);
  detach();
});
