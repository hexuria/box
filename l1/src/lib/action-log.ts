import { formatX11ButtonSuffix } from "./cua-pointer";
import type { RecipeStepJson } from "./recipe-plan";

/** Idle gap that ends a type phrase and starts a new one. */
export const TYPE_IDLE_MS = 650;

export type TypeCoalescer = {
  draft(): string;
  clear(): void;
  pushType(text: string, at: number): RecipeStepJson[];
  backspace(at: number): RecipeStepJson[];
  flushThen(step: RecipeStepJson, at: number): RecipeStepJson[];
  flush(at: number): RecipeStepJson[];
  idleFlush(at: number): RecipeStepJson[];
};

/**
 * Buffer printable typing for the action log / recipe.
 * Guest input is sent separately so takeover still feels live.
 */
export function createTypeCoalescer(): TypeCoalescer {
  let draft = "";
  let lastCharAt: number | null = null;

  function takeDraft(): RecipeStepJson[] {
    if (!draft) {
      return [];
    }
    const text = draft;
    draft = "";
    lastCharAt = null;
    return [{ op: "type", text }];
  }

  return {
    draft() {
      return draft;
    },
    clear() {
      draft = "";
      lastCharAt = null;
    },
    pushType(text, at) {
      const out: RecipeStepJson[] = [];
      if (draft && lastCharAt != null && at - lastCharAt >= TYPE_IDLE_MS) {
        out.push(...takeDraft());
      }
      draft += text;
      lastCharAt = at;
      return out;
    },
    backspace(at) {
      if (draft.length > 0) {
        draft = draft.slice(0, -1);
        lastCharAt = at;
        return [];
      }
      return [{ op: "key", key: "BackSpace" }];
    },
    flushThen(step, _at) {
      const out = takeDraft();
      out.push(step);
      return out;
    },
    flush(_at) {
      return takeDraft();
    },
    idleFlush(at) {
      if (!draft || lastCharAt == null || at - lastCharAt < TYPE_IDLE_MS) {
        return [];
      }
      return takeDraft();
    },
  };
}

export function formatLogLine(step: RecipeStepJson): string | null {
  if (step.op === "wait") {
    return null;
  }
  if (step.op === "type" && typeof step.text === "string") {
    return `type ${JSON.stringify(step.text)}`;
  }
  if (step.op === "key" && typeof step.key === "string") {
    const action =
      typeof step.action === "string" && step.action !== "tap"
        ? ` ${step.action}`
        : "";
    return `key ${step.key}${action}`;
  }
  if (
    (step.op === "click" ||
      step.op === "double_click" ||
      step.op === "move" ||
      step.op === "press" ||
      step.op === "release") &&
    typeof step.x === "number" &&
    typeof step.y === "number"
  ) {
    return `${step.op}${formatX11ButtonSuffix(step.button)} (${step.x}, ${step.y})`;
  }
  if (
    step.op === "drag" &&
    typeof step.x1 === "number" &&
    typeof step.y1 === "number" &&
    typeof step.x2 === "number" &&
    typeof step.y2 === "number"
  ) {
    return `drag${formatX11ButtonSuffix(step.button)} (${step.x1}, ${step.y1}) → (${step.x2}, ${step.y2})`;
  }
  if (
    step.op === "scroll" &&
    typeof step.x === "number" &&
    typeof step.y === "number"
  ) {
    const dx = typeof step.dx === "number" ? step.dx : 0;
    const dy = typeof step.dy === "number" ? step.dy : 0;
    const parts = [`scroll (${step.x}, ${step.y})`];
    if (dx) {
      parts.push(`dx ${dx}`);
    }
    if (dy) {
      parts.push(`dy ${dy}`);
    }
    return parts.join(" ");
  }
  return step.op;
}
