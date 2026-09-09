import type { RecipeStepJson } from "./recipe-plan";

/** Thinking pauses shorter than this are never kept. */
export const TEACH_WAIT_KEEP_MIN_MS = 400;

/** Page-paint waits after Return are capped here. */
export const TEACH_WAIT_CAP_MS = 800;

function cloneStep(step: RecipeStepJson): RecipeStepJson {
  return { ...step };
}

export function cloneRecipeSteps(steps: RecipeStepJson[]): RecipeStepJson[] {
  return steps.map(cloneStep);
}

export function recipeStepsEqual(a: RecipeStepJson[], b: RecipeStepJson[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isEraseKey(step: RecipeStepJson): boolean {
  return step.op === "key" && (step.key === "BackSpace" || step.key === "Delete");
}

function isReturnKey(step: RecipeStepJson): boolean {
  return step.op === "key" && step.key === "Return";
}

function isPaintFollowup(step: RecipeStepJson): boolean {
  return step.op === "click" || step.op === "double_click" || step.op === "scroll";
}

function waitDuration(step: RecipeStepJson): number {
  return typeof step.ms === "number" && Number.isFinite(step.ms) ? Math.max(0, step.ms) : 0;
}

function typeText(step: RecipeStepJson): string {
  return typeof step.text === "string" ? step.text : "";
}

function keyName(step: RecipeStepJson): string {
  return typeof step.key === "string" ? step.key.toLowerCase() : "";
}

function keyAction(step: RecipeStepJson): string {
  return typeof step.action === "string" ? step.action.toLowerCase() : "tap";
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

function isWait(step: RecipeStepJson): boolean {
  return step.op === "wait";
}

/**
 * Collapse a recorded Ctrl+L hold (optional extra ctrl tap, waits, l down/up,
 * ctrl up) into one `ctrl+l` tap. Separate down/up at 0ms never focuses the
 * omnibox; a real chord does. Teach, compress, and Cook all use this so
 * v1/v2/v3 emit `{ "op": "key", "key": "ctrl+l" }`.
 */
export function foldOmniboxChords(steps: RecipeStepJson[]): RecipeStepJson[] {
  const out: RecipeStepJson[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i]!;
    if (!isCtrl(step) || (keyAction(step) !== "down" && keyAction(step) !== "tap")) {
      out.push(cloneStep(step));
      i += 1;
      continue;
    }
    let j = i + 1;
    let sawL = false;
    let end = i;
    while (j < steps.length) {
      const next = steps[j]!;
      if (isWait(next)) {
        end = j;
        j += 1;
        continue;
      }
      if (isCtrl(next)) {
        end = j;
        j += 1;
        continue;
      }
      if (isLKey(next)) {
        sawL = true;
        end = j;
        j += 1;
        continue;
      }
      break;
    }
    if (sawL) {
      out.push({ op: "key", key: "ctrl+l" });
      i = end + 1;
      continue;
    }
    out.push(cloneStep(step));
    i += 1;
  }
  return out;
}

/**
 * Compress a raw Teach-a-task recording (v1) into a cookable plan (v2).
 *
 * **Type merge.** Consecutive `type` steps, including those separated only by
 * `wait` and by `key: BackSpace` / `key: Delete`, collapse into one string.
 * Erases apply as UTF-16 code units (`String.prototype.slice`). Extra erases
 * past empty become leftover `key` steps (emitted before a following `type` in
 * the same run, or when the run ends). After Return / Tab / click / drag /
 * scroll / chord (any other op), flush the type buffer as one `type` then emit
 * that delimiter. Types are never merged across `key Return`.
 *
 * **Per-fragment waits.** Waits between type keystrokes and backspaces are
 * dropped. They are thinking pauses, not recipe steps.
 *
 * **Smart wait.** Default: drop all waits. Keep at most one wait after
 * `key Return` when the next kept step is `click` / `double_click` / `scroll`
 * and the pause is ≥ `TEACH_WAIT_KEEP_MIN_MS` (400ms), capped at
 * `TEACH_WAIT_CAP_MS` (800ms). Consecutive wait steps are summed as one pause.
 * Waits before/between type, backspace, or another wait (thinking) are dropped.
 * Prefer fewer waits: a Return that is followed by more typing or a chord
 * does not keep a wait.
 *
 * **Chords.** `ctrl`/`l` down/up collapses to one `{ op: "key", key: "ctrl+l" }`
 * tap (same as Teach/Cook). Separate down/up never focuses the omnibox.
 *
 * **No-ops.** Empty `type` strings are dropped.
 */
export function compressRecipeSteps(steps: RecipeStepJson[]): RecipeStepJson[] {
  const folded = foldOmniboxChords(steps);
  const out: RecipeStepJson[] = [];
  let buf = "";
  let overflow: string[] = [];
  let pendingWaitMs = 0;
  let lastKept: RecipeStepJson | null = null;

  function remember(step: RecipeStepJson) {
    lastKept = step;
  }

  function flushType() {
    if (buf) {
      const step: RecipeStepJson = { op: "type", text: buf };
      out.push(step);
      remember(step);
      buf = "";
    }
    for (const key of overflow) {
      const step: RecipeStepJson = { op: "key", key };
      out.push(step);
      remember(step);
    }
    overflow = [];
  }

  function flushSmartWait(next: RecipeStepJson) {
    if (
      pendingWaitMs >= TEACH_WAIT_KEEP_MIN_MS &&
      lastKept != null &&
      isReturnKey(lastKept) &&
      isPaintFollowup(next)
    ) {
      const step: RecipeStepJson = {
        op: "wait",
        ms: Math.min(TEACH_WAIT_CAP_MS, Math.round(pendingWaitMs)),
      };
      out.push(step);
      remember(step);
    }
    pendingWaitMs = 0;
  }

  function applyErase(key: string) {
    pendingWaitMs = 0;
    if (buf.length > 0) {
      buf = buf.slice(0, -1);
    } else {
      overflow.push(key);
    }
  }

  function flushOverflowBeforeType() {
    if (overflow.length === 0) {
      return;
    }
    for (const key of overflow) {
      const step: RecipeStepJson = { op: "key", key };
      out.push(step);
      remember(step);
    }
    overflow = [];
  }

  for (const step of folded) {
    if (step.op === "wait") {
      pendingWaitMs += waitDuration(step);
      continue;
    }
    if (step.op === "type") {
      pendingWaitMs = 0;
      flushOverflowBeforeType();
      buf += typeText(step);
      continue;
    }
    if (isEraseKey(step)) {
      applyErase(String(step.key ?? "BackSpace"));
      continue;
    }
    flushType();
    flushSmartWait(step);
    const kept = cloneStep(step);
    out.push(kept);
    remember(kept);
  }
  flushType();
  return out;
}
