"use client";

import { memo, useEffect, useRef } from "react";
import type RFB from "@novnc/novnc";
import { FRAMEBUFFER } from "@/lib/config";
import { desktopRfbUrl } from "@/lib/vnc-path";
import {
  attachVncGuestRecorder,
  type VncGuestPointer,
  type VncGuestWheel,
} from "@/lib/vnc-record";

export type VncPhase = "idle" | "connecting" | "connected" | "disconnected" | "error";

export type { VncGuestPointer, VncGuestWheel };

export const VncSurface = memo(function VncSurface({
  id,
  disabled,
  active,
  session = 0,
  recording = false,
  onPhase,
  onError,
  onGuestPointer,
  onGuestWheel,
  onGuestKeyDown,
  onGuestKeyUp,
}: {
  id: string;
  disabled: boolean;
  active: boolean;
  session?: number;
  /** Teach a task or the action log is open — subscribe, but do not inject CUA. */
  recording?: boolean;
  onPhase: (phase: VncPhase) => void;
  onError: (message: string | null) => void;
  onGuestPointer?: (event: VncGuestPointer) => void;
  onGuestWheel?: (event: VncGuestWheel) => void;
  onGuestKeyDown?: (event: KeyboardEvent) => void;
  onGuestKeyUp?: (event: KeyboardEvent) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const onPhaseRef = useRef(onPhase);
  const onErrorRef = useRef(onError);
  const recordingRef = useRef(recording);
  const activeRef = useRef(active);
  const onGuestPointerRef = useRef(onGuestPointer);
  const onGuestWheelRef = useRef(onGuestWheel);
  const onGuestKeyDownRef = useRef(onGuestKeyDown);
  const onGuestKeyUpRef = useRef(onGuestKeyUp);
  onPhaseRef.current = onPhase;
  onErrorRef.current = onError;
  recordingRef.current = recording;
  activeRef.current = active;
  onGuestPointerRef.current = onGuestPointer;
  onGuestWheelRef.current = onGuestWheel;
  onGuestKeyDownRef.current = onGuestKeyDown;
  onGuestKeyUpRef.current = onGuestKeyUp;

  useEffect(() => {
    if (disabled) {
      rfbRef.current?.disconnect();
      rfbRef.current = null;
      onPhaseRef.current("idle");
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let cancelled = false;
    let rfb: RFB | null = null;
    let detachRecorder: (() => void) | undefined;
    onPhaseRef.current("connecting");
    onErrorRef.current(null);

    void import("@novnc/novnc").then(({ default: RFBClient }) => {
      if (cancelled || !hostRef.current) {
        return;
      }
      host.replaceChildren();
      rfb = new RFBClient(host, desktopRfbUrl(id), {
        shared: true,
        wsProtocols: ["binary"],
      });
      rfb.scaleViewport = true;
      rfb.clipViewport = false;
      rfb.resizeSession = false;
      rfb.showDotCursor = true;
      rfb.focusOnClick = true;
      rfb.viewOnly = !activeRef.current;
      rfb.background = "#1c4a6e";
      // Loopback RFB: skip extra zlib (CPU on x11vnc) and keep Tight JPEG at
      // the noVNC LAN default. quality 8 was extra encode work for little gain.
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 0;
      rfbRef.current = rfb;

      const hookRecorder = () => {
        if (detachRecorder || cancelled) {
          return;
        }
        const canvas = host.querySelector("canvas");
        if (!canvas) {
          return;
        }
        detachRecorder = attachVncGuestRecorder(
          canvas,
          {
            recording: () => recordingRef.current,
            onPointer: (event) => onGuestPointerRef.current?.(event),
            onWheel: (event) => onGuestWheelRef.current?.(event),
            onKeyDown: (event) => onGuestKeyDownRef.current?.(event),
            onKeyUp: (event) => onGuestKeyUpRef.current?.(event),
          },
          window,
        );
      };
      hookRecorder();

      const onConnect = () => {
        hookRecorder();
        if (!cancelled) {
          onPhaseRef.current("connected");
          onErrorRef.current(null);
          if (rfb) {
            rfb.viewOnly = !activeRef.current;
            if (activeRef.current) {
              rfb.focus();
            }
          }
        }
      };
      const onDisconnect = (event: Event) => {
        const clean = Boolean((event as CustomEvent<{ clean?: boolean }>).detail?.clean);
        rfbRef.current = null;
        detachRecorder?.();
        detachRecorder = undefined;
        if (cancelled) {
          return;
        }
        onPhaseRef.current("disconnected");
        if (!clean) {
          onErrorRef.current("Disconnected from the live desktop.");
        }
      };
      const onSecurity = (event: Event) => {
        onPhaseRef.current("error");
        onErrorRef.current(
          (event as CustomEvent<{ reason?: string }>).detail?.reason ||
            "Could not open the live desktop.",
        );
      };

      rfb.addEventListener("connect", onConnect);
      rfb.addEventListener("disconnect", onDisconnect);
      rfb.addEventListener("securityfailure", onSecurity);
    });

    return () => {
      cancelled = true;
      detachRecorder?.();
      rfb?.disconnect();
      rfbRef.current = null;
    };
  }, [disabled, id, session]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) {
      return;
    }
    rfb.viewOnly = !active;
    if (active) {
      rfb.focus();
      window.dispatchEvent(new Event("resize"));
    }
  }, [active]);

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      className="absolute inset-0 overflow-hidden outline-none [&_canvas]:cursor-none"
      aria-label={`Live desktop ${FRAMEBUFFER.width} by ${FRAMEBUFFER.height}`}
    />
  );
});
