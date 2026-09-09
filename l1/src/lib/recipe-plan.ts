import { FRAMEBUFFER } from "./config";

export type RecipeStepJson = {
  op: string;
  [key: string]: unknown;
};

export type RecipePlan = {
  id?: string;
  name?: string;
  stop_on_error?: boolean;
  screenshot?: "none" | "end" | "each";
  steps: RecipeStepJson[];
};

export const RECIPE_OPS: {
  op: string;
  title: string;
  blurb: string;
  example: RecipeStepJson;
}[] = [
  {
    op: "click",
    title: "click",
    blurb: "Left click at x,y (button 1). Right click is button 3.",
    example: { op: "click", x: 640, y: 80, button: 1 },
  },
  {
    op: "double_click",
    title: "double_click",
    blurb: "Two clicks at x,y.",
    example: { op: "double_click", x: 640, y: 400, button: 1 },
  },
  {
    op: "move",
    title: "move",
    blurb: "Move the pointer without clicking.",
    example: { op: "move", x: 100, y: 100 },
  },
  {
    op: "drag",
    title: "drag",
    blurb: "Press at x1,y1, move along a path, release at x2,y2 (Openbox title-bar move).",
    example: { op: "drag", x1: 200, y1: 200, x2: 500, y2: 400, button: 1 },
  },
  {
    op: "press",
    title: "press",
    blurb: "Button down at x,y. Pair with release to drag live.",
    example: { op: "press", x: 200, y: 40, button: 1 },
  },
  {
    op: "release",
    title: "release",
    blurb: "Button up, optionally after a motion path.",
    example: { op: "release", x: 500, y: 200, button: 1 },
  },
  {
    op: "type",
    title: "type",
    blurb: "Type UTF-8 text into the focused field.",
    example: { op: "type", text: "https://www.google.com" },
  },
  {
    op: "key",
    title: "key",
    blurb: "xdotool key: Return, BackSpace, Tab, ctrl+l. action tap (default), down, or up.",
    example: { op: "key", key: "Return" },
  },
  {
    op: "scroll",
    title: "scroll",
    blurb: "Wheel at x,y. Positive dy is down.",
    example: { op: "scroll", x: 640, y: 400, dx: 0, dy: 120 },
  },
  {
    op: "wait",
    title: "wait",
    blurb: "Pause up to 10s so the page can paint.",
    example: { op: "wait", ms: 400 },
  },
  {
    op: "screenshot",
    title: "screenshot",
    blurb: "Capture mid-plan when screenshot is not already end/each.",
    example: { op: "screenshot" },
  },
  {
    op: "reset_desktop",
    title: "reset_desktop",
    blurb:
      "Close every window and leftover job on this guest. Same box and VNC session — not a Docker restart. Put this first so the next clicks hit an empty desktop.",
    example: { op: "reset_desktop" },
  },
];

export const CATALOG: {
  id: string;
  name: string;
  blurb: string;
  plan: RecipePlan;
}[] = [
  {
    id: "open-google",
    name: "Open Google",
    blurb: "Focus the omnibox, type google.com, wait for paint.",
    plan: {
      name: "Open Google",
      stop_on_error: true,
      screenshot: "end",
      steps: [
        { op: "click", x: 640, y: 80, button: 1 },
        { op: "key", key: "ctrl+l" },
        { op: "type", text: "https://www.google.com" },
        { op: "key", key: "Return" },
        { op: "wait", ms: 800 },
      ],
    },
  },
  {
    id: "focus-omnibox",
    name: "Focus omnibox",
    blurb: "Click the Chrome URL bar and select it with ctrl+l.",
    plan: {
      name: "Focus omnibox",
      stop_on_error: true,
      screenshot: "end",
      steps: [
        { op: "click", x: 640, y: 80, button: 1 },
        { op: "key", key: "ctrl+l" },
      ],
    },
  },
  {
    id: "search-query",
    name: "Search",
    blurb: "Type a query into the focused field and press Return.",
    plan: {
      name: "Search",
      stop_on_error: true,
      screenshot: "end",
      steps: [
        { op: "click", x: 640, y: 80, button: 1 },
        { op: "key", key: "ctrl+l" },
        { op: "type", text: "grok box computer use" },
        { op: "key", key: "Return" },
        { op: "wait", ms: 600 },
      ],
    },
  },
  {
    id: "wait-screenshot",
    name: "Wait + screenshot",
    blurb: "Pause, then capture the framebuffer mid-plan.",
    plan: {
      name: "Wait + screenshot",
      stop_on_error: true,
      screenshot: "none",
      steps: [
        { op: "wait", ms: 400 },
        { op: "screenshot" },
      ],
    },
  },
  {
    id: "reset-desktop",
    name: "Reset desktop",
    blurb: "Close Chromium, Terminal, Files, and leftover jobs. Dock stays; VNC stays on this box.",
    plan: {
      name: "Reset desktop",
      stop_on_error: true,
      screenshot: "end",
      steps: [{ op: "reset_desktop" }],
    },
  },
  {
    id: "lint-fail",
    name: "Lint-fail (out of range)",
    blurb: `Named example: click x=${FRAMEBUFFER.width} is outside 0…${FRAMEBUFFER.width - 1}. Cook lints and does not move.`,
    plan: {
      name: "Lint-fail (out of range)",
      stop_on_error: true,
      screenshot: "end",
      steps: [{ op: "click", x: FRAMEBUFFER.width, y: 0, button: 1 }],
    },
  },
  {
    id: "scroll-page",
    name: "Scroll",
    blurb: "Wheel down at the center of the framebuffer.",
    plan: {
      name: "Scroll",
      stop_on_error: true,
      screenshot: "end",
      steps: [{ op: "scroll", x: 640, y: 400, dx: 0, dy: 120 }],
    },
  },
  {
    id: "type-url",
    name: "Type URL",
    blurb: "Type an https URL into the focused field.",
    plan: {
      name: "Type URL",
      stop_on_error: true,
      screenshot: "end",
      steps: [{ op: "type", text: "https://example.com" }],
    },
  },
];

export const SMOKE_RECIPE = stringifyPlan(CATALOG[0]!.plan);
export const LINT_FAIL_RECIPE = stringifyPlan(
  CATALOG.find((item) => item.id === "lint-fail")!.plan,
);

export type StepField = {
  key: string;
  label: string;
  kind: "int" | "text";
  min?: number;
  max?: number;
};

/** http(s) URL with no whitespace. Used when the type text looks like a URL. */
export const TYPE_URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

export function stringifyPlan(plan: RecipePlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function emptyPlan(name = "recipe"): RecipePlan {
  return { name, stop_on_error: true, screenshot: "end", steps: [] };
}

export function emptyPlanJson(name = "recipe"): string {
  return stringifyPlan(emptyPlan(name));
}

export function parsePlan(text: string): { plan: RecipePlan } | { error: string } {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Plan must be a JSON object with a steps array." };
    }
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.steps)) {
      return { error: "Plan must include a steps array." };
    }
    return { plan: record as RecipePlan };
  } catch {
    return { error: "Invalid JSON." };
  }
}

export function insertStep(text: string, step: RecipeStepJson): string {
  const parsed = parsePlan(text);
  const plan: RecipePlan =
    "plan" in parsed
      ? parsed.plan
      : emptyPlan("plan");
  return stringifyPlan({
    ...plan,
    steps: [...(plan.steps ?? []), step],
  });
}

export function moveStepAt(text: string, index: number, dir: -1 | 1): string {
  const parsed = parsePlan(text);
  if ("error" in parsed) {
    return text;
  }
  const steps = [...(parsed.plan.steps ?? [])];
  const next = index + dir;
  if (next < 0 || next >= steps.length) {
    return text;
  }
  const swap = steps[index];
  steps[index] = steps[next];
  steps[next] = swap;
  return stringifyPlan({ ...parsed.plan, steps });
}

export function removeStepAt(text: string, index: number): string {
  const parsed = parsePlan(text);
  if ("error" in parsed) {
    return text;
  }
  return stringifyPlan({
    ...parsed.plan,
    steps: (parsed.plan.steps ?? []).filter((_, i) => i !== index),
  });
}

export function replaceStepAt(
  text: string,
  index: number,
  step: RecipeStepJson,
): string {
  const parsed = parsePlan(text);
  if ("error" in parsed) {
    return text;
  }
  const steps = [...(parsed.plan.steps ?? [])];
  if (!steps[index]) {
    return text;
  }
  steps[index] = step;
  return stringifyPlan({ ...parsed.plan, steps });
}

export function reorderSteps(text: string, from: number, to: number): string {
  const parsed = parsePlan(text);
  if ("error" in parsed) {
    return text;
  }
  const steps = [...(parsed.plan.steps ?? [])];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= steps.length ||
    to >= steps.length
  ) {
    return text;
  }
  const [item] = steps.splice(from, 1);
  if (!item) {
    return text;
  }
  steps.splice(to, 0, item);
  return stringifyPlan({ ...parsed.plan, steps });
}

export function setPlanName(text: string, name: string): string {
  const parsed = parsePlan(text);
  const plan: RecipePlan = "plan" in parsed ? parsed.plan : emptyPlan(name);
  return stringifyPlan({ ...plan, name });
}

export function fieldsForOp(op: string): StepField[] {
  const x: StepField = {
    key: "x",
    label: "x",
    kind: "int",
    min: 0,
    max: FRAMEBUFFER.width - 1,
  };
  const y: StepField = {
    key: "y",
    label: "y",
    kind: "int",
    min: 0,
    max: FRAMEBUFFER.height - 1,
  };
  if (op === "click" || op === "double_click" || op === "move" || op === "press") {
    const fields = [x, y];
    if (op !== "move") {
      fields.push({ key: "button", label: "button", kind: "int", min: 1, max: 7 });
    }
    return fields;
  }
  if (op === "release") {
    return [
      x,
      y,
      { key: "button", label: "button", kind: "int", min: 1, max: 7 },
    ];
  }
  if (op === "scroll") {
    return [
      x,
      y,
      { key: "dx", label: "dx", kind: "int" },
      { key: "dy", label: "dy", kind: "int" },
    ];
  }
  if (op === "drag") {
    return [
      {
        key: "x1",
        label: "x1",
        kind: "int",
        min: 0,
        max: FRAMEBUFFER.width - 1,
      },
      {
        key: "y1",
        label: "y1",
        kind: "int",
        min: 0,
        max: FRAMEBUFFER.height - 1,
      },
      {
        key: "x2",
        label: "x2",
        kind: "int",
        min: 0,
        max: FRAMEBUFFER.width - 1,
      },
      {
        key: "y2",
        label: "y2",
        kind: "int",
        min: 0,
        max: FRAMEBUFFER.height - 1,
      },
    ];
  }
  if (op === "key") {
    return [
      { key: "key", label: "key", kind: "text" },
      { key: "action", label: "action", kind: "text" },
    ];
  }
  if (op === "wait") {
    return [{ key: "ms", label: "ms", kind: "int", min: 0, max: 10_000 }];
  }
  if (op === "type") {
    return [{ key: "text", label: "text", kind: "text" }];
  }
  return [];
}

export function stepFieldValues(step: RecipeStepJson): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fieldsForOp(step.op)) {
    const raw = step[field.key];
    values[field.key] = raw == null ? "" : String(raw);
  }
  return values;
}

export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }
  if (/^www\./i.test(trimmed) && trimmed.includes(".")) {
    return true;
  }
  return false;
}

export function validateTypeText(text: string): string | null {
  if (!text) {
    return "Text is required.";
  }
  if (!looksLikeUrl(text)) {
    return null;
  }
  const normalized = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  if (/\s/.test(text) || !TYPE_URL_RE.test(normalized)) {
    return "This looks like a URL. Use a valid http(s) URL with no spaces.";
  }
  return null;
}

function parseIntField(
  raw: string,
  field: StepField,
): { value: number } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: `${field.label} is required.` };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return { error: `${field.label} must be an integer.` };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { error: `${field.label} must be an integer.` };
  }
  if (field.min != null && value < field.min) {
    return { error: `${field.label} must be ${field.min}…${field.max ?? "∞"}.` };
  }
  if (field.max != null && value > field.max) {
    return { error: `${field.label} must be ${field.min ?? "-∞"}…${field.max}.` };
  }
  return { value };
}

export function commitStepFields(
  step: RecipeStepJson,
  values: Record<string, string>,
): { step: RecipeStepJson } | { errors: Record<string, string> } {
  const fields = fieldsForOp(step.op);
  const errors: Record<string, string> = {};
  const next: RecipeStepJson = { ...step };
  for (const field of fields) {
    const raw = values[field.key] ?? "";
    if (field.key === "button" && field.kind === "int" && !raw.trim()) {
      next.button = typeof step.button === "number" ? step.button : 1;
      continue;
    }
    if (field.kind === "int") {
      const parsed = parseIntField(raw, field);
      if ("error" in parsed) {
        errors[field.key] = parsed.error;
      } else {
        next[field.key] = parsed.value;
      }
      continue;
    }
    const text = raw;
    if (field.key === "key") {
      if (!text.trim()) {
        errors[field.key] = "Key is required.";
      } else if (text.split("").some((ch) => ch === " " || ch === ";" || ch === "\t")) {
        errors[field.key] = "Key cannot contain spaces or semicolons.";
      } else {
        next[field.key] = text.trim();
      }
      continue;
    }
    if (field.key === "action") {
      const v = text.trim().toLowerCase();
      if (!v || v === "tap") {
        delete next.action;
      } else if (v === "down" || v === "up") {
        next.action = v;
      } else {
        errors.action = "action must be tap, down, or up.";
      }
      continue;
    }
    if (field.key === "text") {
      const urlError = validateTypeText(text);
      if (urlError) {
        errors[field.key] = urlError;
      } else {
        next[field.key] = text;
      }
      continue;
    }
    if (!text.trim()) {
      errors[field.key] = `${field.label} is required.`;
    } else {
      next[field.key] = text;
    }
  }
  if (step.op === "scroll") {
    const dx = next.dx;
    const dy = next.dy;
    if (
      !errors.dx &&
      !errors.dy &&
      typeof dx === "number" &&
      typeof dy === "number" &&
      dx === 0 &&
      dy === 0
    ) {
      errors.dy = "dx and dy must not both be 0.";
    }
  }
  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { step: next };
}

export function summarizeStep(step: RecipeStepJson): string {
  if (
    step.op === "click" ||
    step.op === "double_click" ||
    step.op === "move" ||
    step.op === "press" ||
    step.op === "release"
  ) {
    return `${step.x},${step.y}`;
  }
  if (step.op === "drag") {
    return `${step.x1},${step.y1} → ${step.x2},${step.y2}`;
  }
  if (step.op === "type") {
    return JSON.stringify(step.text ?? "");
  }
  if (step.op === "key") {
    const action = step.action && step.action !== "tap" ? ` ${step.action}` : "";
    return `${step.key ?? ""}${action}`;
  }
  if (step.op === "scroll") {
    return `${step.x},${step.y} dx ${step.dx} dy ${step.dy}`;
  }
  if (step.op === "wait") {
    return `${step.ms}ms`;
  }
  if (step.op === "reset_desktop" || step.op === "reset") {
    return "close windows";
  }
  return "";
}

export function planFromRecording(
  steps: RecipeStepJson[],
  name = "recorded",
): string {
  return stringifyPlan({
    name,
    stop_on_error: true,
    screenshot: "end",
    steps,
  });
}

export function typedUrlsPreview(text: string): string | null {
  const parsed = parsePlan(text);
  if ("error" in parsed) {
    return parsed.error;
  }
  const typed = (parsed.plan.steps ?? [])
    .filter((step) => step.op === "type" && typeof step.text === "string")
    .map((step) => String(step.text));
  return typed.length ? `Cook will type: ${typed.join(" → ")}` : "No type steps in this plan.";
}

function isTypeRunStep(step?: RecipeStepJson): boolean {
  if (!step) {
    return false;
  }
  if (step.op === "type") {
    return true;
  }
  return step.op === "key" && (step.key === "BackSpace" || step.key === "Delete");
}

export function appendRecordedStep(
  steps: RecipeStepJson[],
  next: RecipeStepJson,
  gapMs: number,
): RecipeStepJson[] {
  const out = [...steps];
  const lastRecorded = out[out.length - 1];
  // Skip thinking pauses between type/backspace fragments only. Keep a wait
  // after Return / click / Tab even when the next step is type so raw v1
  // records the page-load pause before the email field.
  if (gapMs >= 400 && !(isTypeRunStep(next) && isTypeRunStep(lastRecorded))) {
    out.push({ op: "wait", ms: Math.min(10_000, Math.round(gapMs)) });
  }
  const last = out[out.length - 1];
  if (
    next.op === "double_click" &&
    last?.op === "click" &&
    last.x === next.x &&
    last.y === next.y
  ) {
    const prev = out[out.length - 2];
    if (prev?.op === "click" && prev.x === next.x && prev.y === next.y) {
      out.pop();
      out.pop();
    } else {
      out.pop();
    }
  }
  out.push(next);
  return out;
}
