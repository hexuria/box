"use client";

import { useEffect, type ReactNode, type Ref } from "react";
import { CircleDot, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FRAMEBUFFER } from "@/lib/config";

const FRAMEBUFFER_ASPECT = `${FRAMEBUFFER.width} / ${FRAMEBUFFER.height}`;
const STAGE_BG = "bg-[#1c4a6e]";

function FramebufferStage({
  takeover,
  children,
}: {
  takeover: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        takeover
          ? `relative h-full w-full max-h-full max-w-full cursor-default overflow-hidden ${STAGE_BG}`
          : `relative w-full cursor-default overflow-hidden ${STAGE_BG} aspect-[1280/800]`
      }
      style={{ aspectRatio: FRAMEBUFFER_ASPECT }}
    >
      {children}
    </div>
  );
}

function TrafficLight({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={(event) => event.preventDefault()}
      className="flex size-6 cursor-pointer items-center justify-center rounded-full hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`size-3 rounded-full ${color}`} aria-hidden />
    </button>
  );
}

function TrafficLights({
  disabled,
  onClose,
  onMinimize,
  onMaximize,
}: {
  disabled?: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <TrafficLight
        label="Close"
        color="bg-[#ff5f57]"
        disabled={disabled}
        onClick={onClose}
      />
      <TrafficLight
        label="Minimize"
        color="bg-[#febc2e]"
        disabled={disabled}
        onClick={onMinimize}
      />
      <TrafficLight
        label="Maximize"
        color="bg-[#28c840]"
        disabled={disabled}
        onClick={onMaximize}
      />
    </div>
  );
}

export function ComputerUseFrame({
  takeover,
  teaching,
  teachCount,
  disabled,
  onEnterTakeover,
  onExitTakeover,
  onTeachToggle,
  logOpen = false,
  onToggleLog,
  surface,
  log,
  surfaceRef,
}: {
  takeover: boolean;
  teaching: boolean;
  teachCount: number;
  disabled?: boolean;
  onEnterTakeover: () => void;
  onExitTakeover: () => void;
  onTeachToggle: () => void;
  logOpen?: boolean;
  onToggleLog?: () => void;
  surface: ReactNode;
  log?: ReactNode;
  surfaceRef?: Ref<HTMLDivElement>;
}) {
  useEffect(() => {
    if (!takeover) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [takeover]);

  const windowedHeader = (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-[#1a1a1a] px-3 text-white">
      <TrafficLights
        disabled={disabled}
        onClose={onExitTakeover}
        onMinimize={onExitTakeover}
        onMaximize={onEnterTakeover}
      />
      <div className="min-w-0 flex-1" />
    </header>
  );

  const overlayHeader = (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-[#1a1a1a] px-3 text-white">
      <TrafficLights
        disabled={disabled}
        onClose={onExitTakeover}
        onMinimize={onExitTakeover}
        onMaximize={onEnterTakeover}
      />
      <div className="min-w-0 flex-1" />
      {onToggleLog ? (
        <Button
          type="button"
          size="sm"
          variant="chrome"
          aria-pressed={logOpen}
          aria-label={logOpen ? "Hide action log" : "Show action log"}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onToggleLog}
        >
          <List />
          Log
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="chrome"
        disabled={disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={onTeachToggle}
        className={
          teaching
            ? "border-red-400/40 bg-red-500/20 text-white hover:bg-red-500/30 hover:text-white"
            : undefined
        }
      >
        <CircleDot className={teaching ? "text-red-400" : "text-white"} />
        {teaching ? `Save to Recipe (${teachCount})` : "Teach a task"}
      </Button>
    </header>
  );

  return (
    <>
      {takeover ? (
        <div
          className="aspect-[1280/800] w-full overflow-hidden rounded-xl border border-white/10 bg-[#0b1c2c]"
          aria-hidden
        />
      ) : null}
      <div
        className={
          takeover
            ? "fixed inset-0 z-[200] flex flex-col bg-[#0b1c2c] text-white"
            : "overflow-hidden rounded-xl border border-white/10 bg-[#0b1c2c] shadow-lg"
        }
      >
        {takeover ? overlayHeader : windowedHeader}
        <div className="relative min-h-0 flex-1">
          <div
            ref={surfaceRef}
            tabIndex={0}
            className={
              takeover
                ? "flex h-full min-h-0 cursor-default items-center justify-center overflow-hidden p-3 outline-none"
                : "outline-none"
            }
          >
            <FramebufferStage takeover={takeover}>{surface}</FramebufferStage>
          </div>
          {log && logOpen && takeover ? (
            <aside className="absolute inset-y-3 right-3 z-10 flex w-80 max-w-[min(20rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-lg border border-white/15 bg-black/90 shadow-2xl">
              {log}
            </aside>
          ) : null}
        </div>
      </div>
    </>
  );
}
