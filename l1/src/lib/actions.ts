"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loginMatches, requireL1Session, sessionCookieOptions, SESSION_COOKIE } from "./auth";
import { tryGetL1Token } from "./config";
import * as ensurebox from "./ensurebox";
import { EnsureboxError } from "./ensurebox";
import type { RecipeReceipt, RecipeRequest, ScreenshotResult } from "./types";
import {
  artifactsFromReceipt,
  cookArtifactDir,
  newCookRunId,
  pngsToPersist,
  type CookArtifact,
} from "./cook-artifacts";

function isNextControlFlow(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (err as { digest: string }).digest.startsWith("NEXT_NOT_FOUND"))
  );
}

function fail(err: unknown): { error: string } {
  if (isNextControlFlow(err)) {
    throw err;
  }
  if (err instanceof EnsureboxError) {
    return { error: err.message };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}

export async function loginAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const loaded = tryGetL1Token();
  if ("error" in loaded) {
    return { error: loaded.error };
  }
  const presented = String(formData.get("token") || "");
  if (!loginMatches(presented)) {
    return { error: "invalid token" };
  }
  const jar = await cookies();
  jar.set(sessionCookieOptions(presented));
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  jar.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  redirect("/");
}

export async function createBoxAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  try {
    await requireL1Session();
    const name = String(formData.get("name") || "").trim();
    const box = await ensurebox.createBox(name || undefined);
    revalidatePath("/");
    redirect(`/boxes/${box.id}`);
  } catch (err) {
    return fail(err);
  }
}

export async function startBoxAction(id: string) {
  await requireL1Session();
  await ensurebox.startBox(id);
  revalidatePath("/");
  revalidatePath(`/boxes/${id}`);
}

export async function destroyBoxAction(
  id: string,
): Promise<{ error: string } | null> {
  try {
    await requireL1Session();
    const boxId = id.trim();
    if (!boxId) {
      return { error: "Workspace id is required." };
    }
    await ensurebox.destroyBox(boxId);
    revalidatePath("/");
    revalidatePath(`/boxes/${boxId}`);
    redirect("/");
  } catch (err) {
    return fail(err);
  }
}

export async function execAction(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; result?: unknown }> {
  try {
    await requireL1Session();
    const command = String(formData.get("command") || "").trim();
    if (!command) {
      return { error: "command is required" };
    }
    const result = await ensurebox.execCommand(id, command);
    revalidatePath(`/boxes/${id}`);
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function writeFileAction(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; result?: unknown }> {
  try {
    await requireL1Session();
    const path = String(formData.get("path") || "").trim();
    const content = String(formData.get("content") || "");
    if (!path) {
      return { error: "path is required" };
    }
    const result = await ensurebox.writeFile(id, path, content);
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function readFileAction(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; result?: unknown }> {
  try {
    await requireL1Session();
    const path = String(formData.get("path") || "").trim();
    if (!path) {
      return { error: "path is required" };
    }
    const result = await ensurebox.readFile(id, path);
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function screenshotAction(
  id: string,
): Promise<{ error?: string; png?: string; width?: number; height?: number }> {
  try {
    await requireL1Session();
    const result = await ensurebox.screenshot(id);
    if (!result.png_base64) {
      return { error: "EnsureBox screenshot response missing png_base64" };
    }
    return {
      png: result.png_base64,
      width: result.width,
      height: result.height,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function clickAction(
  id: string,
  x: number,
  y: number,
  button = 1,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.click(id, x, y, button);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function doubleClickAction(
  id: string,
  x: number,
  y: number,
  button = 1,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.doubleClick(id, x, y, button);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function dragAction(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  button = 1,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.drag(id, { x1, y1, x2, y2, button });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function typeAction(
  id: string,
  text: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.typeText(id, text);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function keyAction(
  id: string,
  key: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.sendKey(id, key);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function scrollAction(
  id: string,
  dx: number,
  dy: number,
  x = 640,
  y = 400,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.scroll(id, { x, y, dx, dy });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Drop huge PNGs from the receipt JSON; keep width/height/bytes/path for the UI dump. */
function omitPng(shot: ScreenshotResult | undefined): ScreenshotResult | undefined {
  if (!shot) {
    return shot;
  }
  const { png_base64: _omitted, ...rest } = shot;
  return rest;
}

function sanitizeReceipt(raw: RecipeReceipt): RecipeReceipt {
  const steps = (raw.steps ?? []).map((step) => ({
    ...step,
    screenshot: omitPng(step.screenshot),
  }));
  return {
    ...raw,
    steps,
    screenshot: omitPng(raw.screenshot),
  };
}

async function persistInlinePngs(
  id: string,
  dir: string,
  raw: RecipeReceipt,
): Promise<CookArtifact[]> {
  const pending = pngsToPersist(raw);
  if (pending.length === 0) {
    return [];
  }
  await ensurebox.mkdir(id, dir);
  const out: CookArtifact[] = [];
  for (const item of pending) {
    const path = `${dir}/${item.name}`;
    try {
      await ensurebox.writeFile(id, path, item.png, "base64");
      out.push({
        kind: "screenshot",
        label: item.label,
        path,
        mime: "image/png",
        width: item.width,
        height: item.height,
        stepIndex: item.stepIndex,
      });
    } catch (err) {
      console.info(
        JSON.stringify({
          msg: "l1.cook.artifact.write_failed",
          path,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return out;
}

function failRecipe(err: unknown): {
  error: string;
  status?: number;
  code?: string;
  lintFailed?: boolean;
} {
  if (isNextControlFlow(err)) {
    throw err;
  }
  if (err instanceof EnsureboxError) {
    if (err.status === 400) {
      return {
        error: `${err.message} The guest lints the whole plan first (HTTP 400${err.code ? ` ${err.code}` : ""}); nothing moved.`,
        status: err.status,
        code: err.code,
        lintFailed: true,
      };
    }
    if (err.status === 404) {
      return {
        error: `${err.message} This guest may predate POST /v1/cua/recipe — rebuild grok-box:local and create a new workspace.`,
        status: err.status,
        code: err.code,
      };
    }
    return { error: err.message, status: err.status, code: err.code };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}

export async function recipeAction(
  id: string,
  planJson: string,
  opts?: { record?: boolean },
): Promise<{
  error?: string;
  status?: number;
  code?: string;
  lintFailed?: boolean;
  result?: RecipeReceipt;
  artifacts?: CookArtifact[];
  recordingError?: string;
}> {
  try {
    await requireL1Session();
    let parsed: unknown;
    try {
      parsed = JSON.parse(planJson);
    } catch {
      return { error: "Invalid JSON. Fix the plan and try again. Nothing was sent." };
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
      return { error: "Recipe must be a JSON object with a steps array. Nothing was sent." };
    }
    if (parsed.steps.length === 0) {
      return {
        error:
          "steps must not be empty. The guest would reject this with HTTP 400 and nothing would move.",
        status: 400,
        lintFailed: true,
      };
    }
    const runId = newCookRunId();
    const artifactDir = cookArtifactDir(runId);
    const record = opts?.record !== false;
    const body: RecipeRequest = {
      steps: parsed.steps,
      artifact_dir: artifactDir,
      record,
    };
    if (typeof parsed.name === "string") {
      body.name = parsed.name;
    }
    if (typeof parsed.stop_on_error === "boolean") {
      body.stop_on_error = parsed.stop_on_error;
    }
    if (
      parsed.screenshot === "none" ||
      parsed.screenshot === "end" ||
      parsed.screenshot === "each"
    ) {
      body.screenshot = parsed.screenshot;
    }
    const raw = await ensurebox.runRecipe(id, body);
    let artifacts = artifactsFromReceipt(raw);
    if (!artifacts.some((item) => item.kind === "screenshot")) {
      const persisted = await persistInlinePngs(id, artifactDir, raw);
      artifacts = [...artifacts, ...persisted];
    }
    const recordingError =
      typeof raw.recording_error === "string" && raw.recording_error.trim()
        ? raw.recording_error
        : record && !artifacts.some((item) => item.kind === "recording")
          ? "Cook recording did not land as a playable file. Rebuild grok-box:local so the guest has ffmpeg, then cook again."
          : undefined;
    return {
      result: sanitizeReceipt(raw),
      artifacts,
      recordingError,
    };
  } catch (err) {
    return failRecipe(err);
  }
}
