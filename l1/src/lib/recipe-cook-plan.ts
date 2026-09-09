import type { CookPlanVersion } from "./cook-results";
import { foldOmniboxChords } from "./recipe-compress";
import type { RecipeStepJson } from "./recipe-plan";

export { foldOmniboxChords };

/** Dock band on the 1280×800 guest (tint2 sits in the bottom ~80px). */
export const DOCK_Y_MIN = 700;

/** Teach-scale pause after a dock launch so Chromium can map. */
export const RAW_LAUNCH_WAIT_MS = 2200;

/** Teach-scale pause after a URL Return so the page can paint before typing. */
export const RAW_PAGE_WAIT_MS = 2800;

const CLOSE_X_FROM_RIGHT = 18;
const CLOSE_Y = 16;

function cloneStep(step: RecipeStepJson): RecipeStepJson {
  return { ...step };
}

function keyName(step: RecipeStepJson): string {
  return typeof step.key === "string" ? step.key.toLowerCase() : "";
}

function isKey(step: RecipeStepJson, name: string): boolean {
  return step.op === "key" && keyName(step) === name;
}

function isCtrl(step: RecipeStepJson): boolean {
  return isKey(step, "ctrl") || isKey(step, "control");
}

function isLKey(step: RecipeStepJson): boolean {
  return isKey(step, "l");
}

function isReturnKey(step: RecipeStepJson): boolean {
  return step.op === "key" && (keyName(step) === "return" || keyName(step) === "enter");
}

function isWait(step: RecipeStepJson): boolean {
  return step.op === "wait";
}

function waitMs(step: RecipeStepJson): number {
  return typeof step.ms === "number" && Number.isFinite(step.ms) ? Math.max(0, step.ms) : 0;
}

function typeText(step: RecipeStepJson): string {
  return typeof step.text === "string" ? step.text : "";
}

function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  return (
    /^https?:\/\//i.test(trimmed) ||
    /^www\./i.test(trimmed) ||
    /\.(com|net|org|io|dev|app|co)([/:?#]|$)/i.test(trimmed)
  );
}

function ensureWaitAtLeast(
  steps: RecipeStepJson[],
  index: number,
  minMs: number,
): RecipeStepJson[] {
  const next = steps[index];
  if (next && isWait(next)) {
    if (waitMs(next) >= minMs) {
      return steps;
    }
    const copy = steps.map(cloneStep);
    copy[index] = { op: "wait", ms: minMs };
    return copy;
  }
  const copy = steps.map(cloneStep);
  copy.splice(index, 0, { op: "wait", ms: minMs });
  return copy;
}

export function ensureLaunchWait(steps: RecipeStepJson[]): RecipeStepJson[] {
  let out = steps.map(cloneStep);
  for (let i = 0; i < out.length; i += 1) {
    const step = out[i]!;
    if (step.op !== "click" && step.op !== "double_click") {
      continue;
    }
    const y = typeof step.y === "number" ? step.y : 0;
    if (y < DOCK_Y_MIN) {
      continue;
    }
    out = ensureWaitAtLeast(out, i + 1, RAW_LAUNCH_WAIT_MS);
    i += 1;
  }
  return out;
}

export function ensurePageWaits(steps: RecipeStepJson[]): RecipeStepJson[] {
  let out = steps.map(cloneStep);
  for (let i = 0; i < out.length; i += 1) {
    if (!isReturnKey(out[i]!)) {
      continue;
    }
    let typedUrl = false;
    for (let k = i - 1; k >= 0; k -= 1) {
      const prev = out[k]!;
      if (isWait(prev) || isCtrl(prev) || isLKey(prev)) {
        continue;
      }
      if (prev.op === "type" && looksLikeUrl(typeText(prev))) {
        typedUrl = true;
      }
      break;
    }
    if (!typedUrl) {
      continue;
    }
    out = ensureWaitAtLeast(out, i + 1, RAW_PAGE_WAIT_MS);
    i += 1;
  }
  return out;
}

/** Last click in the top-right chrome is almost always Close — aim at the X. */
export function rewriteCloseClick(
  steps: RecipeStepJson[],
  width = 1280,
): RecipeStepJson[] {
  if (steps.some((step) => step.op === "reset_desktop" || step.op === "reset")) {
    return steps.map(cloneStep);
  }
  const last = steps[steps.length - 1];
  if (!last || last.op !== "click") {
    return steps.map(cloneStep);
  }
  const x = typeof last.x === "number" ? last.x : 0;
  const y = typeof last.y === "number" ? last.y : 0;
  if (x < width * 0.7 || y > 220) {
    return steps.map(cloneStep);
  }
  const copy = steps.map(cloneStep);
  copy[copy.length - 1] = {
    op: "click",
    x: width - CLOSE_X_FROM_RIGHT,
    y: CLOSE_Y,
    button: typeof last.button === "number" ? last.button : 1,
  };
  return copy;
}

/**
 * Make a raw (v1) plan actually playable. v2/v3 stay compressed: only the
 * Ctrl+L chord is folded so the omnibox can focus. Guest-side smart waits
 * still run for every version.
 */
export function prepareCookSteps(
  steps: RecipeStepJson[],
  version: CookPlanVersion,
): RecipeStepJson[] {
  const folded = foldOmniboxChords(steps);
  if (version !== "v1") {
    return folded;
  }
  return rewriteCloseClick(ensurePageWaits(ensureLaunchWait(folded)));
}

export function cookSettleMode(version: CookPlanVersion): "raw" | "compressed" {
  return version === "v1" ? "raw" : "compressed";
}
