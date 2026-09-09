import { FRAMEBUFFER } from "./config";
import { browserButtonToX } from "./cua-pointer";

/** CSS canvas box → guest framebuffer (recipes are 1280×800, origin top-left). */
export type CanvasBox = {
  width: number;
  height: number;
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

export type VncGuestPointer = {
  type: "down" | "move" | "up";
  x: number;
  y: number;
  button: number;
};

export type VncGuestWheel = {
  x: number;
  y: number;
  dx: number;
  dy: number;
};

export type VncGuestRecorderHandlers = {
  recording(): boolean;
  onPointer(event: VncGuestPointer): void;
  onWheel(event: VncGuestWheel): void;
  onKeyDown(event: KeyboardEvent): void;
  onKeyUp(event: KeyboardEvent): void;
};

type ListenerTarget = {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
};

/**
 * noVNC listens for mousedown/mouseup on the canvas and stopPropagation()s.
 * On press it also setCapture()s: Chrome covers the page with
 * #noVNC_mouse_capture_elem, so React pointerup on the VNC wrapper never
 * sees the release. Native canvas down + window capture up/move still fire.
 * Do not preventDefault or stopPropagation — VNC injects the click itself.
 */
export function framebufferPointFromClient(
  clientX: number,
  clientY: number,
  canvas: CanvasBox,
  fb: { width: number; height: number } = FRAMEBUFFER,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width;
  const cssH = rect.height;
  if (cssW <= 0 || cssH <= 0) {
    return { x: 0, y: 0 };
  }
  const x = Math.round(((clientX - rect.left) / cssW) * fb.width);
  const y = Math.round(((clientY - rect.top) / cssH) * fb.height);
  return {
    x: Math.min(Math.max(x, 0), fb.width - 1),
    y: Math.min(Math.max(y, 0), fb.height - 1),
  };
}

export function wheelStep(delta: number): number {
  if (delta === 0) {
    return 0;
  }
  return delta > 0 ? 120 : -120;
}

export function attachVncGuestRecorder(
  canvas: CanvasBox & ListenerTarget,
  handlers: VncGuestRecorderHandlers,
  target: ListenerTarget,
): () => void {
  let pressed = false;

  const point = (event: MouseEvent) =>
    framebufferPointFromClient(event.clientX, event.clientY, canvas);

  const onMove = (event: Event) => {
    if (!pressed) {
      return;
    }
    const mouse = event as MouseEvent;
    handlers.onPointer({
      type: "move",
      ...point(mouse),
      button: browserButtonToX(mouse.button),
    });
  };

  const onUp = (event: Event) => {
    if (!pressed) {
      return;
    }
    pressed = false;
    target.removeEventListener("mousemove", onMove, true);
    target.removeEventListener("mouseup", onUp, true);
    const mouse = event as MouseEvent;
    handlers.onPointer({
      type: "up",
      ...point(mouse),
      button: browserButtonToX(mouse.button),
    });
  };

  const onDown = (event: Event) => {
    if (!handlers.recording()) {
      return;
    }
    const mouse = event as MouseEvent;
    if (mouse.button > 2) {
      return;
    }
    if (pressed) {
      target.removeEventListener("mousemove", onMove, true);
      target.removeEventListener("mouseup", onUp, true);
    }
    pressed = true;
    target.addEventListener("mousemove", onMove, true);
    target.addEventListener("mouseup", onUp, true);
    handlers.onPointer({
      type: "down",
      ...point(mouse),
      button: browserButtonToX(mouse.button),
    });
  };

  const onWheel = (event: Event) => {
    if (!handlers.recording()) {
      return;
    }
    const wheel = event as WheelEvent;
    const dx = wheelStep(wheel.deltaX);
    const dy = wheelStep(wheel.deltaY);
    if (dx === 0 && dy === 0) {
      return;
    }
    handlers.onWheel({ ...point(wheel), dx, dy });
  };

  const onKeyDown = (event: Event) => {
    if (!handlers.recording()) {
      return;
    }
    handlers.onKeyDown(event as KeyboardEvent);
  };

  const onKeyUp = (event: Event) => {
    if (!handlers.recording()) {
      return;
    }
    handlers.onKeyUp(event as KeyboardEvent);
  };

  canvas.addEventListener("mousedown", onDown, true);
  canvas.addEventListener("wheel", onWheel, { capture: true, passive: true });
  canvas.addEventListener("keydown", onKeyDown, true);
  canvas.addEventListener("keyup", onKeyUp, true);

  return () => {
    canvas.removeEventListener("mousedown", onDown, true);
    canvas.removeEventListener("wheel", onWheel, true);
    canvas.removeEventListener("keydown", onKeyDown, true);
    canvas.removeEventListener("keyup", onKeyUp, true);
    target.removeEventListener("mousemove", onMove, true);
    target.removeEventListener("mouseup", onUp, true);
    pressed = false;
  };
}
