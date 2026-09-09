"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionLog } from "@/components/action-log";
import { ComputerUseFrame } from "@/components/computer-use-frame";
import {
  VncSurface,
  type VncGuestPointer,
  type VncGuestWheel,
  type VncPhase,
} from "@/components/vnc-surface";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TYPE_IDLE_MS, createTypeCoalescer } from "@/lib/action-log";
import { FRAMEBUFFER } from "@/lib/config";
import { browserEventToCua, browserModifierToCua } from "@/lib/cua-keys";
import { isPointerDrag } from "@/lib/cua-pointer";
import { compressRecipeSteps, foldOmniboxChords } from "@/lib/recipe-compress";
import {
  appendRecordedStep,
  planFromRecording,
  type RecipeStepJson,
} from "@/lib/recipe-plan";

export type TeachRecordingSend = {
  planJson: string;
  v1: RecipeStepJson[];
  v2: RecipeStepJson[];
};

export type DesktopShot = { png: string; width: number; height: number };

export function DesktopViewer({
  id,
  disabled,
  active = true,
  maximized,
  onMaximizedChange,
  onSendToRecipe,
}: {
  id: string;
  workspaceName?: string;
  disabled: boolean;
  active?: boolean;
  maximized: boolean;
  onMaximizedChange: (value: boolean) => void;
  seedShot?: DesktopShot | null;
  onSendToRecipe: (payload: TeachRecordingSend) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<VncPhase>("idle");
  const [session, setSession] = useState(0);
  const [teaching, setTeaching] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [steps, setSteps] = useState<RecipeStepJson[]>([]);
  const [status, setStatus] = useState("");
  const lastActionAt = useRef(0);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const heldButton = useRef<number | null>(null);
  const lastClick = useRef<{ x: number; y: number; at: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<RecipeStepJson[]>([]);
  const teachingFrom = useRef(0);
  const coalescer = useRef(createTypeCoalescer());
  const idleTimer = useRef<number>(0);
  const recordActions = teaching || logOpen;

  stepsRef.current = steps;

  const commitLog = useCallback((flushed: RecipeStepJson[]) => {
    if (flushed.length === 0) {
      return;
    }
    setSteps((prev) => {
      let next = prev;
      let last = lastActionAt.current;
      const now = Date.now();
      for (const step of flushed) {
        const gap = last ? now - last : 0;
        next = appendRecordedStep(next, step, gap);
        last = now;
      }
      lastActionAt.current = last;
      stepsRef.current = next;
      return next;
    });
  }, []);

  const cancelIdleFlush = useCallback(() => {
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = 0;
    }
  }, []);

  const scheduleIdleFlush = useCallback(() => {
    cancelIdleFlush();
    idleTimer.current = window.setTimeout(() => {
      commitLog(coalescer.current.idleFlush(Date.now()));
    }, TYPE_IDLE_MS);
  }, [cancelIdleFlush, commitLog]);

  useEffect(() => () => cancelIdleFlush(), [cancelIdleFlush]);

  useEffect(() => {
    if (!active && maximized) {
      onMaximizedChange(false);
    }
  }, [active, maximized, onMaximizedChange]);

  const enterTakeover = useCallback(() => {
    if (disabled) {
      return;
    }
    onMaximizedChange(true);
    setStatus("Yellow or red exits the expanded view. Esc is sent to the guest.");
  }, [disabled, onMaximizedChange]);

  const exitTakeover = useCallback(() => {
    cancelIdleFlush();
    commitLog(coalescer.current.flush(Date.now()));
    onMaximizedChange(false);
    setStatus("");
  }, [cancelIdleFlush, commitLog, onMaximizedChange]);

  function recordPointerStep(step: RecipeStepJson) {
    if (!recordActions) {
      return;
    }
    cancelIdleFlush();
    commitLog(coalescer.current.flush(Date.now()));
    commitLog([step]);
  }

  function onGuestPointer(event: VncGuestPointer) {
    if (disabled || !recordActions) {
      return;
    }
    if (event.type === "down") {
      dragOrigin.current = { x: event.x, y: event.y };
      dragging.current = false;
      heldButton.current = event.button;
      return;
    }
    if (event.type === "move") {
      if (!dragOrigin.current || heldButton.current == null) {
        return;
      }
      if (isPointerDrag(dragOrigin.current, { x: event.x, y: event.y })) {
        dragging.current = true;
      }
      return;
    }
    if (!dragOrigin.current || heldButton.current == null) {
      return;
    }
    const origin = dragOrigin.current;
    const button = heldButton.current;
    const moved = dragging.current;
    dragOrigin.current = null;
    dragging.current = false;
    heldButton.current = null;
    if (moved) {
      recordPointerStep({
        op: "drag",
        x1: origin.x,
        y1: origin.y,
        x2: event.x,
        y2: event.y,
        button,
      });
      return;
    }
    const now = Date.now();
    const prev = lastClick.current;
    if (
      prev &&
      now - prev.at < 400 &&
      Math.abs(prev.x - origin.x) < 4 &&
      Math.abs(prev.y - origin.y) < 4
    ) {
      lastClick.current = null;
      recordPointerStep({
        op: "double_click",
        x: origin.x,
        y: origin.y,
        button,
      });
      return;
    }
    lastClick.current = { x: origin.x, y: origin.y, at: now };
    recordPointerStep({ op: "click", x: origin.x, y: origin.y, button });
  }

  function onGuestWheel(event: VncGuestWheel) {
    if (disabled || !recordActions) {
      return;
    }
    cancelIdleFlush();
    commitLog(coalescer.current.flush(Date.now()));
    commitLog([{ op: "scroll", x: event.x, y: event.y, dx: event.dx, dy: event.dy }]);
  }

  function onGuestKeyDown(event: KeyboardEvent) {
    if (disabled || !recordActions || event.isComposing) {
      return;
    }
    // Modifier down/up is not a recipe step. Ctrl+L is one tap via browserEventToCua.
    if (browserModifierToCua(event)) {
      return;
    }
    const mapped = browserEventToCua(event);
    if (!mapped) {
      return;
    }
    const now = Date.now();
    if (mapped.kind === "type") {
      commitLog(coalescer.current.pushType(mapped.text, now));
      scheduleIdleFlush();
      return;
    }
    if (mapped.key === "BackSpace") {
      commitLog(coalescer.current.backspace(now));
      if (coalescer.current.draft()) {
        scheduleIdleFlush();
      } else {
        cancelIdleFlush();
      }
      return;
    }
    cancelIdleFlush();
    commitLog(coalescer.current.flushThen({ op: "key", key: mapped.key }, now));
  }

  function onGuestKeyUp(_event: KeyboardEvent) {
    // Combined keys are recorded on keydown as one tap.
  }

  function startTeaching() {
    teachingFrom.current = stepsRef.current.length;
    setTeaching(true);
    setStatus("Teaching. Click, type, and scroll — Save to Recipe when done.");
  }

  function stopAndSend() {
    cancelIdleFlush();
    commitLog(coalescer.current.flush(Date.now()));
    setTeaching(false);
    const recorded = stepsRef.current.slice(teachingFrom.current);
    if (recorded.length === 0) {
      setStatus("Nothing recorded.");
      return;
    }
    const v1 = foldOmniboxChords(recorded.map((step) => ({ ...step })));
    const v2 = compressRecipeSteps(v1);
    onSendToRecipe({
      planJson: planFromRecording(v2, "recorded"),
      v1,
      v2,
    });
  }

  function clearLogs() {
    cancelIdleFlush();
    coalescer.current.clear();
    setSteps([]);
    stepsRef.current = [];
    lastActionAt.current = 0;
    teachingFrom.current = 0;
    setStatus("Logs cleared.");
  }

  const teachCount = Math.max(0, steps.length - teachingFrom.current);

  const overlayCopy = disabled
    ? "Workspace is not ready."
    : phase === "connected"
      ? null
      : phase === "error" || (phase === "disconnected" && error)
        ? error || "Disconnected from the live desktop."
        : phase === "disconnected"
          ? "Disconnected from the live desktop."
          : "Connecting to the live desktop…";

  const showReconnect =
    !disabled && (phase === "disconnected" || phase === "error");

  const surface = (
    <div className="absolute inset-0" onContextMenu={(event) => event.preventDefault()}>
      <VncSurface
        id={id}
        disabled={disabled}
        active={active}
        session={session}
        recording={recordActions}
        onPhase={setPhase}
        onError={setError}
        onGuestPointer={onGuestPointer}
        onGuestWheel={onGuestWheel}
        onGuestKeyDown={onGuestKeyDown}
        onGuestKeyUp={onGuestKeyUp}
      />
      {overlayCopy ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#1c4a6e]/80 px-4 text-center text-sm text-white/90">
          <p>{overlayCopy}</p>
          {showReconnect ? (
            <Button
              type="button"
              variant="chrome"
              onClick={() => {
                setError(null);
                setSession((value) => value + 1);
              }}
            >
              Reconnect
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const log = (
    <ActionLog
      steps={steps}
      onClear={clearLogs}
      variant={maximized ? "chrome" : "page"}
      empty={
        maximized
          ? "No clicks, keys, or scrolls recorded yet."
          : "No actions yet."
      }
    />
  );

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-muted-foreground">
        This is a live VNC session of the {FRAMEBUFFER.width}×{FRAMEBUFFER.height}{" "}
        guest display. Pointer, keyboard, and the guest cursor go through an
        authenticated EnsureBox proxy — not a screenshot viewer. Origin is
        top-left. Drag a title bar to move a window; drag an edge or the
        bottom-right grip to resize. L1 green/yellow/red only control the
        expanded view. Teach a task and the action log live in that chrome.
        Recipes still cook through Computer Use on the same desktop. Leaving
        this tab no longer drops VNC, so a YouTube tab (or anything else) is
        still on this guest when you come back. Cook screenshots and recordings
        open on Recipe — they are not a second desktop.
      </p>
      {error && phase !== "connecting" ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      <ComputerUseFrame
        takeover={maximized && active}
        teaching={teaching}
        teachCount={teachCount}
        disabled={disabled}
        onEnterTakeover={enterTakeover}
        onExitTakeover={exitTakeover}
        onTeachToggle={() => (teaching ? stopAndSend() : startTeaching())}
        logOpen={logOpen}
        onToggleLog={() => setLogOpen((open) => !open)}
        surface={surface}
        log={maximized && active ? log : undefined}
        surfaceRef={surfaceRef}
      />
    </div>
  );
}
