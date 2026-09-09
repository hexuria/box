/** Browser MouseEvent.button → X11 button (1 left, 2 middle, 3 right). */
export function browserButtonToX(button: number): number {
  if (button === 1) {
    return 2;
  }
  if (button === 2) {
    return 3;
  }
  return 1;
}

/** X11 button 1/2/3 → log name. Unknown numbers stay numeric. */
export function x11ButtonName(button: number): string {
  if (button === 1) {
    return "left";
  }
  if (button === 2) {
    return "middle";
  }
  if (button === 3) {
    return "right";
  }
  return String(button);
}

/** ` button=right` for non-left; left is the recipe default and stays implicit. */
export function formatX11ButtonSuffix(button: unknown): string {
  if (typeof button !== "number" || button === 1) {
    return "";
  }
  return ` button=${x11ButtonName(button)}`;
}

/**
 * Guest pixels of held-pointer slop that still count as a click.
 * Openbox Close is Click-or-Press on a title-bar button; CUA screenshot
 * scaling plus a 1px WM dragThreshold turned jitter into a move grab.
 */
export const CLICK_SLOP_PX = 16;

export function pointerDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function isPointerDrag(
  origin: { x: number; y: number },
  point: { x: number; y: number },
  slopPx = CLICK_SLOP_PX,
): boolean {
  return pointerDistance(origin, point) > slopPx;
}

/** Keep a drag trail sparse enough for one release HTTP call (guest max 64). */
export function sampleDragPath(
  trail: { x: number; y: number }[],
  next: { x: number; y: number },
  minGap = 8,
): { x: number; y: number }[] {
  const last = trail[trail.length - 1];
  if (!last || pointerDistance(last, next) >= minGap) {
    return [...trail, next];
  }
  return trail;
}

/**
 * Intermediate points from press to release, excluding the end (mouseup
 * warps there). Openbox needs several MotionNotify events while Button1 is held.
 */
export function interpolateHeldPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number }[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    return [];
  }
  const steps = Math.min(24, Math.max(8, Math.ceil(dist / 40)));
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    out.push({
      x: Math.round(x1 + dx * t),
      y: Math.round(y1 + dy * t),
    });
  }
  return out;
}
