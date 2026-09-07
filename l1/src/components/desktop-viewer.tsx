"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clickAction,
  doubleClickAction,
  dragAction,
  keyAction,
  screenshotAction,
  scrollAction,
  typeAction,
} from "@/lib/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FRAMEBUFFER } from "@/lib/config";
import { browserEventToCua } from "@/lib/cua-keys";
import {
  appendRecordedStep,
  planFromRecording,
  type RecipeStepJson,
} from "@/lib/recipe-plan";

type Shot = { png: string; width: number; height: number };

function pointFromEvent(
  event: { clientX: number; clientY: number; currentTarget: EventTarget },
  shot: Shot,
): { x: number; y: number } {
  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const x = Math.round(((event.clientX - rect.left) / rect.width) * shot.width);
  const y = Math.round(((event.clientY - rect.top) / rect.height) * shot.height);
  return {
    x: Math.min(Math.max(x, 0), shot.width - 1),
    y: Math.min(Math.max(y, 0), shot.height - 1),
  };
}

export function DesktopViewer({
  id,
  disabled,
  active = true,
  onSendToRecipe,
}: {
  id: string;
  disabled: boolean;
  active?: boolean;
  onSendToRecipe: (planJson: string) => void;
}) {
  const [shot, setShot] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [recording, setRecording] = useState(false);
  const [steps, setSteps] = useState<RecipeStepJson[]>([]);
  const [status, setStatus] = useState("Click Follow or Maximize, then use the mouse and keyboard on the picture.");
  const lastActionAt = useRef(0);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const recordingRef = useRef(false);
  const stepsRef = useRef<RecipeStepJson[]>([]);
  const typeBuf = useRef("");
  const keyBuf = useRef<string[]>([]);

  busyRef.current = busy;
  recordingRef.current = recording;
  stepsRef.current = steps;

  const record = useCallback((step: RecipeStepJson) => {
    if (!recordingRef.current) {
      return;
    }
    const now = Date.now();
    const gap = lastActionAt.current ? now - lastActionAt.current : 0;
    lastActionAt.current = now;
    setSteps((prev) => {
      const next = appendRecordedStep(prev, step, gap);
      stepsRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const next = await screenshotAction(id);
    if (next.error) {
      setError(next.error);
      return false;
    }
    if (next.png) {
      setShot({
        png: next.png,
        width: next.width ?? FRAMEBUFFER.width,
        height: next.height ?? FRAMEBUFFER.height,
      });
      setError(null);
    }
    return true;
  }, [id]);

  const run = useCallback(
    async (label: string, task: () => Promise<{ error?: string }>, step?: RecipeStepJson) => {
      if (disabled || busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setStatus(label);
      try {
        const result = await task();
        if (result.error) {
          setError(result.error);
          return;
        }
        if (step) {
          record(step);
        }
        await refresh();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      const pending = typeBuf.current;
      if (pending) {
        typeBuf.current = "";
        await run(`type ${pending}`, () => typeAction(id, pending), {
          op: "type",
          text: pending,
        });
        return;
      }
      const nextKey = keyBuf.current.shift();
      if (nextKey) {
        await run(`key ${nextKey}`, () => keyAction(id, nextKey), {
          op: "key",
          key: nextKey,
        });
      }
    },
    [disabled, id, record, refresh],
  );

  useEffect(() => {
    if (disabled || !active) {
      return;
    }
    void refresh();
  }, [active, disabled, refresh]);

  useEffect(() => {
    if (disabled || !live || !active) {
      return;
    }
    const timer = window.setInterval(() => {
      if (busyRef.current || document.visibilityState !== "visible") {
        return;
      }
      void refresh();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [active, disabled, live, refresh]);

  useEffect(() => {
    if (!active) {
      setMaximized(false);
    }
  }, [active]);

  useEffect(() => {
    if (!maximized) {
      return;
    }
    surfaceRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMaximized(false);
        return;
      }
      const mapped = browserEventToCua(event);
      if (!mapped) {
        return;
      }
      event.preventDefault();
      if (mapped.kind === "type") {
        typeBuf.current += mapped.text;
        if (!busyRef.current) {
          const text = typeBuf.current;
          typeBuf.current = "";
          void run(`type ${text}`, () => typeAction(id, text), {
            op: "type",
            text,
          });
        }
        return;
      }
      if (busyRef.current || typeBuf.current) {
        keyBuf.current.push(mapped.key);
        if (!busyRef.current && typeBuf.current) {
          const text = typeBuf.current;
          typeBuf.current = "";
          void run(`type ${text}`, () => typeAction(id, text), {
            op: "type",
            text,
          });
        }
        return;
      }
      void run(`key ${mapped.key}`, () => keyAction(id, mapped.key), {
        op: "key",
        key: mapped.key,
      });
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [id, maximized, run]);

  function onPointerDown(event: React.PointerEvent<HTMLImageElement>) {
    if (!shot || disabled) {
      return;
    }
    const point = pointFromEvent(event, shot);
    dragOrigin.current = point;
    dragging.current = false;
  }

  function onPointerMove(event: React.PointerEvent<HTMLImageElement>) {
    if (!shot || !dragOrigin.current) {
      return;
    }
    const point = pointFromEvent(event, shot);
    const dx = point.x - dragOrigin.current.x;
    const dy = point.y - dragOrigin.current.y;
    if (dx * dx + dy * dy > 64) {
      dragging.current = true;
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLImageElement>) {
    if (!shot || !dragOrigin.current) {
      return;
    }
    const origin = dragOrigin.current;
    const point = pointFromEvent(event, shot);
    dragOrigin.current = null;
    if (dragging.current) {
      dragging.current = false;
      void run(
        `drag ${origin.x},${origin.y} → ${point.x},${point.y}`,
        () => dragAction(id, origin.x, origin.y, point.x, point.y, 1),
        {
          op: "drag",
          x1: origin.x,
          y1: origin.y,
          x2: point.x,
          y2: point.y,
          button: 1,
        },
      );
      return;
    }
    const button = event.button === 2 ? 3 : 1;
    void run(
      `click ${point.x},${point.y}`,
      () => clickAction(id, point.x, point.y, button),
      { op: "click", x: point.x, y: point.y, button },
    );
  }

  function onDoubleClick(event: React.MouseEvent<HTMLImageElement>) {
    if (!shot || disabled) {
      return;
    }
    event.preventDefault();
    const point = pointFromEvent(event, shot);
    void run(
      `double_click ${point.x},${point.y}`,
      () => doubleClickAction(id, point.x, point.y, 1),
      { op: "double_click", x: point.x, y: point.y, button: 1 },
    );
  }

  function onWheel(event: React.WheelEvent<HTMLImageElement>) {
    if (!shot || disabled) {
      return;
    }
    event.preventDefault();
    const point = pointFromEvent(event, shot);
    const dy = event.deltaY === 0 ? 0 : event.deltaY > 0 ? 120 : -120;
    const dx = event.deltaX === 0 ? 0 : event.deltaX > 0 ? 120 : -120;
    if (dx === 0 && dy === 0) {
      return;
    }
    void run(
      `scroll ${dx},${dy}`,
      () => scrollAction(id, dx, dy, point.x, point.y),
      { op: "scroll", x: point.x, y: point.y, dx, dy },
    );
  }

  function onContextMenu(event: React.MouseEvent<HTMLImageElement>) {
    event.preventDefault();
  }

  function startRecording() {
    setSteps([]);
    stepsRef.current = [];
    lastActionAt.current = Date.now();
    setRecording(true);
    setStatus("Recording. Click, type, and scroll on the desktop.");
  }

  function stopAndSend() {
    setRecording(false);
    const recorded = stepsRef.current;
    if (recorded.length === 0) {
      setStatus("Nothing recorded.");
      return;
    }
    onSendToRecipe(planFromRecording(recorded, "recorded"));
  }

  const frame = (
    <div className="space-y-2">
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt="Box desktop"
          src={`data:image/png;base64,${shot.png}`}
          draggable={false}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
          className={`cursor-crosshair select-none rounded-lg border border-zinc-200 bg-black ${
            maximized ? "max-h-[calc(100vh-5rem)] max-w-full object-contain" : "w-full max-w-5xl"
          }`}
        />
      ) : (
        <p className="text-sm text-zinc-500">
          {disabled
            ? "Workspace is not ready."
            : "Fetching the first frame…"}
        </p>
      )}
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={disabled || busy} onClick={() => void refresh()}>
        {busy ? "Working…" : "Refresh"}
      </Button>
      <Button
        type="button"
        variant={live ? "default" : "outline"}
        disabled={disabled}
        onClick={() => setLive((value) => !value)}
      >
        {live ? "Follow on" : "Follow off"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setMaximized(true)}
      >
        Maximize
      </Button>
      <Button
        type="button"
        variant={recording ? "destructive" : "outline"}
        disabled={disabled}
        onClick={() => (recording ? stopAndSend() : startRecording())}
      >
        {recording ? `Stop & use as recipe (${steps.length})` : "Record to recipe"}
      </Button>
    </div>
  );

  const body = (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">
        This is the guest framebuffer ({FRAMEBUFFER.width}×{FRAMEBUFFER.height}),
        not a raw viewer port. Click the picture to click. In Maximize, your
        keyboard and scroll wheel go to the box. Record a session to fill the
        Recipe tab — no model required.
      </p>
      {toolbar}
      <p className="text-xs text-zinc-500">{status}</p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {recording && steps.length > 0 ? (
        <ol className="max-h-40 overflow-auto rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs">
          {steps.map((step, index) => (
            <li key={`${step.op}-${index}`}>
              {index} {JSON.stringify(step)}
            </li>
          ))}
        </ol>
      ) : null}
      {frame}
    </div>
  );

  if (!maximized || !active) {
    return body;
  }

  return (
    <>
      {body}
      <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-50">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <p className="text-sm">Desktop — click, type, scroll. Esc exits.</p>
          <span className="flex-1" />
          {recording ? (
            <span className="text-xs text-red-300">recording {steps.length} steps</span>
          ) : null}
          <Button type="button" variant="outline" onClick={() => setMaximized(false)}>
            Exit maximize
          </Button>
        </div>
        <div
          ref={surfaceRef}
          tabIndex={0}
          className="flex flex-1 items-center justify-center overflow-hidden p-3 outline-none"
        >
          {frame}
        </div>
      </div>
    </>
  );
}
