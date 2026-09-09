import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLICK_SLOP_PX,
  browserButtonToX,
  formatX11ButtonSuffix,
  interpolateHeldPath,
  isPointerDrag,
  pointerDistance,
  sampleDragPath,
  x11ButtonName,
} from "./cua-pointer.ts";

test("browser buttons map to X11 1/2/3", () => {
  assert.equal(browserButtonToX(0), 1);
  assert.equal(browserButtonToX(1), 2);
  assert.equal(browserButtonToX(2), 3);
  assert.equal(browserButtonToX(4), 1);
});

test("X11 button names for the action log", () => {
  assert.equal(x11ButtonName(1), "left");
  assert.equal(x11ButtonName(2), "middle");
  assert.equal(x11ButtonName(3), "right");
  assert.equal(formatX11ButtonSuffix(1), "");
  assert.equal(formatX11ButtonSuffix(undefined), "");
  assert.equal(formatX11ButtonSuffix(3), " button=right");
  assert.equal(formatX11ButtonSuffix(2), " button=middle");
});

test("sampleDragPath keeps points at least minGap apart", () => {
  let trail = sampleDragPath([], { x: 10, y: 10 });
  trail = sampleDragPath(trail, { x: 12, y: 10 });
  assert.equal(trail.length, 1);
  trail = sampleDragPath(trail, { x: 20, y: 10 });
  assert.deepEqual(trail, [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
  ]);
  assert.equal(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test("held jitter inside the slop is a click, not a title-bar drag", () => {
  const origin = { x: 920, y: 45 };
  assert.equal(isPointerDrag(origin, origin), false);
  assert.equal(isPointerDrag(origin, { x: 928, y: 47 }), false);
  assert.equal(isPointerDrag(origin, { x: origin.x + CLICK_SLOP_PX, y: origin.y }), false);
  assert.equal(
    isPointerDrag(origin, { x: origin.x + CLICK_SLOP_PX + 1, y: origin.y }),
    true,
  );
  assert.equal(isPointerDrag(origin, { x: 920, y: 70 }), true);
});

test("interpolateHeldPath emits several held moves and omits the end", () => {
  const path = interpolateHeldPath(0, 0, 200, 80);
  assert.ok(path.length >= 7);
  assert.notEqual(path[0]?.x, 0);
  assert.notDeepEqual(path[path.length - 1], { x: 200, y: 80 });
  assert.deepEqual(interpolateHeldPath(5, 5, 5, 5), []);
});
