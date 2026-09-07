import { FRAMEBUFFER } from "./config";

export type RecipeStepJson = {
  op: string;
  [key: string]: unknown;
};

export type RecipePlan = {
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
    blurb: "Press at x1,y1 and release at x2,y2.",
    example: { op: "drag", x1: 200, y1: 200, x2: 500, y2: 400, button: 1 },
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
    blurb: "One xdotool key: Return, BackSpace, Tab, ctrl+l, ctrl+a.",
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
];

export const SMOKE_RECIPE = stringifyPlan({
  name: "focus-and-search",
  stop_on_error: true,
  screenshot: "end",
  steps: [
    { op: "click", x: 640, y: 80, button: 1 },
    { op: "key", key: "ctrl+l" },
    { op: "type", text: "https://www.google.com" },
    { op: "key", key: "Return" },
    { op: "wait", ms: 800 },
  ],
});

export const LINT_FAIL_RECIPE = stringifyPlan({
  name: "lint-fail",
  stop_on_error: true,
  screenshot: "end",
  steps: [{ op: "click", x: FRAMEBUFFER.width, y: 0, button: 1 }],
});

export function stringifyPlan(plan: RecipePlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
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
      : { name: "plan", stop_on_error: true, screenshot: "end", steps: [] };
  return stringifyPlan({
    ...plan,
    steps: [...(plan.steps ?? []), step],
  });
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
  return typed.length ? `Run will type: ${typed.join(" → ")}` : "No type steps in this plan.";
}

export function appendRecordedStep(
  steps: RecipeStepJson[],
  next: RecipeStepJson,
  gapMs: number,
): RecipeStepJson[] {
  const out = [...steps];
  if (gapMs >= 400) {
    out.push({ op: "wait", ms: Math.min(10_000, Math.round(gapMs)) });
  }
  const last = out[out.length - 1];
  if (
    next.op === "type" &&
    last?.op === "type" &&
    typeof last.text === "string" &&
    typeof next.text === "string"
  ) {
    out[out.length - 1] = { op: "type", text: `${last.text}${next.text}` };
    return out;
  }
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
