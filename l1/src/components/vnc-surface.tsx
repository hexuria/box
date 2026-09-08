"use client";

import { memo, useEffect, useRef } from "react";
import type RFB from "@novnc/novnc";
import { FRAMEBUFFER } from "@/lib/config";
import { desktopRfbUrl } from "@/lib/vnc-path";

export type VncPhase = "idle" | "connecting" | "connected" | "disconnected" | "error";

export const VncSurface = memo(function VncSurface({
  id,
  disabled,
  active,
  session = 0,
  onPhase,
  onError,
}: {
  id: string;
  disabled: boolean;
  active: boolean;
  session?: number;
  onPhase: (phase: VncPhase) => void;
  onError: (message: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const onPhaseRef = useRef(onPhase);
  const onErrorRef = useRef(onError);
  onPhaseRef.current = onPhase;
  onErrorRef.current = onError;

  useEffect(() => {
    if (disabled || !active) {
      rfbRef.current?.disconnect();
      rfbRef.current = null;
      onPhaseRef.current(disabled ? "idle" : "disconnected");
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let cancelled = false;
    let rfb: RFB | null = null;
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
      rfb.background = "#1c4a6e";
      // Loopback RFB: skip extra zlib (CPU on x11vnc) and keep Tight JPEG at
      // the noVNC LAN default. quality 8 was extra encode work for little gain.
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 0;
      rfbRef.current = rfb;

      const onConnect = () => {
        if (!cancelled) {
          onPhaseRef.current("connected");
          onErrorRef.current(null);
          rfb?.focus();
        }
      };
      const onDisconnect = (event: Event) => {
        const clean = Boolean((event as CustomEvent<{ clean?: boolean }>).detail?.clean);
        rfbRef.current = null;
        if (cancelled) {
          return;
        }
        onPhaseRef.current("disconnected");
        if (!clean) {
          onErrorRef.current("Disconnected from the live desktop.");
        }
      };
      const onSecurity = (event: Event) => {
        const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
        onPhaseRef.current("error");
        onErrorRef.current(reason || "Could not open the live desktop.");
      };

      rfb.addEventListener("connect", onConnect);
      rfb.addEventListener("disconnect", onDisconnect);
      rfb.addEventListener("securityfailure", onSecurity);
    });

    return () => {
      cancelled = true;
      rfb?.disconnect();
      rfbRef.current = null;
    };
  }, [active, disabled, id, session]);

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      className="absolute inset-0 overflow-hidden outline-none [&_canvas]:cursor-none"
      aria-label={`Live desktop ${FRAMEBUFFER.width} by ${FRAMEBUFFER.height}`}
    />
  );
});
