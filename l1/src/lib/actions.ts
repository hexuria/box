"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loginMatches, requireL1Session, sessionCookieOptions, SESSION_COOKIE } from "./auth";
import { tryGetL1Token } from "./config";
import * as ensurebox from "./ensurebox";
import { EnsureboxError } from "./ensurebox";
import type { ExecResult, FileResult, RecipeReceipt, RecipeRequest, ScreenshotResult } from "./types";
import {
  artifactsFromReceipt,
  cookArtifactDir,
  cookRunIdFromDir,
  newCookRunId,
  pngsToPersist,
  type CookArtifact,
} from "./cook-artifacts";
import {
  cookResultRelPath,
  isCookPlanVersion,
  parseCookRunRecord,
  type CookPlanVersion,
  type CookRunRecord,
} from "./cook-results";
import { SHELL_EXEC_ENV } from "./shell-session";
import { cookSettleMode, prepareCookSteps } from "./recipe-cook-plan";
import { stringifyPlan, type RecipePlan, type RecipeStepJson } from "./recipe-plan";

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

function fail(err: unknown, action?: string): { error: string } {
  if (isNextControlFlow(err)) {
    throw err;
  }
  const message =
    err instanceof EnsureboxError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  if (action) {
    return { error: `${action}. ${message}` };
  }
  return { error: message };
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
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function execLineAction(
  id: string,
  command: string,
  cwd = "",
  timeoutMs = 30_000,
): Promise<{ error?: string; result?: ExecResult }> {
  try {
    await requireL1Session();
    const line = command.trim();
    if (!line) {
      return { error: "command is required" };
    }
    const result = await ensurebox.execCommand(id, line, {
      cwd: cwd || undefined,
      timeout_ms: timeoutMs,
      env: SHELL_EXEC_ENV,
    });
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

export async function listFilesAction(
  id: string,
  path: string,
): Promise<{ error?: string; result?: FileResult }> {
  try {
    await requireL1Session();
    const result = await ensurebox.readFile(id, path);
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function readGuestPathAction(
  id: string,
  path: string,
): Promise<{ error?: string; result?: FileResult }> {
  try {
    await requireL1Session();
    const result = await ensurebox.readFile(id, path);
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function writeGuestPathAction(
  id: string,
  path: string,
  content: string,
  encoding?: string,
): Promise<{ error?: string; result?: FileResult }> {
  try {
    await requireL1Session();
    if (!path.trim()) {
      return { error: "path is required" };
    }
    const result = await ensurebox.writeFile(
      id,
      path,
      content ?? "",
      encoding ?? "utf8",
    );
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteGuestPathAction(
  id: string,
  path: string,
  recursive = false,
): Promise<{ error?: string; result?: FileResult }> {
  try {
    await requireL1Session();
    if (!path.trim()) {
      return { error: "path is required" };
    }
    const result = await ensurebox.deleteFile(id, path, recursive);
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function mkdirGuestPathAction(
  id: string,
  path: string,
): Promise<{ error?: string; result?: FileResult }> {
  try {
    await requireL1Session();
    if (!path.trim()) {
      return { error: "path is required" };
    }
    const result = await ensurebox.mkdir(id, path);
    return { result };
  } catch (err) {
    return fail(err);
  }
}

export async function renameGuestPathAction(
  id: string,
  from: string,
  to: string,
): Promise<{ error?: string; result?: FileResult }> {
  try {
    await requireL1Session();
    if (!from.trim() || !to.trim()) {
      return { error: "from and to are required" };
    }
    const result = await ensurebox.renameFile(id, from, to);
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
      return { error: "Desktop screenshot failed: EnsureBox response missing png_base64." };
    }
    return {
      png: result.png_base64,
      width: result.width,
      height: result.height,
    };
  } catch (err) {
    return fail(err, "Desktop screenshot failed");
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
    return fail(err, `Click at ${x},${y} did not reach the guest`);
  }
}

export async function pressAction(
  id: string,
  x: number,
  y: number,
  button = 1,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.mouseDown(id, x, y, button);
    return { ok: true };
  } catch (err) {
    return fail(err, `Pointer down at ${x},${y} did not reach the guest`);
  }
}

export async function releaseAction(
  id: string,
  body: {
    x?: number;
    y?: number;
    button?: number;
    path?: { x: number; y: number }[];
  },
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.mouseUp(id, body);
    return { ok: true };
  } catch (err) {
    return fail(err, "Pointer up did not reach the guest");
  }
}

export async function moveAction(
  id: string,
  x: number,
  y: number,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.movePointer(id, x, y);
    return { ok: true };
  } catch (err) {
    return fail(err, `Pointer move to ${x},${y} did not reach the guest`);
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
    return fail(err, `Double-click at ${x},${y} did not reach the guest`);
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
    return fail(err, `Drag ${x1},${y1} → ${x2},${y2} did not reach the guest`);
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
    return fail(err, "Typing did not reach the guest");
  }
}

export async function keyAction(
  id: string,
  key: string,
  action?: "tap" | "down" | "up",
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    await ensurebox.sendKey(id, key, action);
    return { ok: true };
  } catch (err) {
    return fail(err, `Key ${key} did not reach the guest`);
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
    return fail(err, `Scroll at ${x},${y} did not reach the guest`);
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

async function persistCookResultFile(id: string, run: CookRunRecord): Promise<void> {
  const path = cookResultRelPath(run.id);
  const dir = cookArtifactDir(run.id);
  try {
    await ensurebox.mkdir(id, dir);
    await ensurebox.writeFile(id, path, JSON.stringify(run), "utf8");
  } catch (err) {
    console.info(
      JSON.stringify({
        msg: "l1.cook.result.write_failed",
        path,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

function cookRunFromAction(input: {
  runId: string;
  boxId: string;
  version: CookPlanVersion;
  planJson: string;
  recipeId?: string;
  recipeName?: string;
  ok: boolean;
  error?: string | null;
  lintFailed?: boolean;
  receipt?: RecipeReceipt | null;
  artifacts?: CookArtifact[];
  recordingError?: string | null;
}): CookRunRecord {
  const receipt = input.receipt ?? null;
  return {
    id: input.runId,
    boxId: input.boxId,
    recipeId: input.recipeId,
    recipeName: input.recipeName,
    version: input.version,
    createdAt: new Date().toISOString(),
    ok: input.ok,
    error: input.error ?? null,
    lintFailed: input.lintFailed,
    durationMs: receipt?.duration_ms ?? null,
    ran: receipt?.ran ?? null,
    stepCount: Array.isArray(receipt?.steps)
      ? receipt.steps.length
      : (() => {
          try {
            const parsed = JSON.parse(input.planJson) as { steps?: unknown };
            return Array.isArray(parsed.steps) ? parsed.steps.length : 0;
          } catch {
            return 0;
          }
        })(),
    planJson: input.planJson,
    receipt,
    artifacts: input.artifacts ?? [],
    recordingError: input.recordingError ?? null,
  };
}

export async function recipeAction(
  id: string,
  planJson: string,
  opts?: {
    record?: boolean;
    version?: CookPlanVersion;
    recipeId?: string;
    recipeName?: string;
  },
): Promise<{
  error?: string;
  status?: number;
  code?: string;
  lintFailed?: boolean;
  result?: RecipeReceipt;
  artifacts?: CookArtifact[];
  recordingError?: string;
  runId?: string;
  cookRun?: CookRunRecord;
}> {
  const version = isCookPlanVersion(opts?.version) ? opts.version : "v3";
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
    const recipeName =
      opts?.recipeName || (typeof parsed.name === "string" ? parsed.name : undefined);
    const recipeId = opts?.recipeId;
    const preparedSteps = prepareCookSteps(parsed.steps as RecipeStepJson[], version);
    const sentPlan: RecipePlan = {
      name: typeof parsed.name === "string" ? parsed.name : recipeName,
      stop_on_error:
        typeof parsed.stop_on_error === "boolean" ? parsed.stop_on_error : true,
      screenshot:
        parsed.screenshot === "none" ||
        parsed.screenshot === "end" ||
        parsed.screenshot === "each"
          ? parsed.screenshot
          : "end",
      steps: preparedSteps,
    };
    const sentJson = stringifyPlan(sentPlan);
    const body: RecipeRequest = {
      steps: preparedSteps,
      artifact_dir: artifactDir,
      record,
      settle: cookSettleMode(version),
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
    try {
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
      const receipt = sanitizeReceipt(raw);
      const cookRun = cookRunFromAction({
        runId,
        boxId: id,
        version,
        planJson: sentJson,
        recipeId,
        recipeName,
        ok: receipt.ok !== false,
        receipt,
        artifacts,
        recordingError,
      });
      await persistCookResultFile(id, cookRun);
      return {
        result: receipt,
        artifacts,
        recordingError,
        runId,
        cookRun,
      };
    } catch (err) {
      const failed = failRecipe(err);
      const cookRun = cookRunFromAction({
        runId,
        boxId: id,
        version,
        planJson: sentJson,
        recipeId,
        recipeName,
        ok: false,
        error: failed.error,
        lintFailed: failed.lintFailed,
        artifacts: [],
      });
      await persistCookResultFile(id, cookRun);
      return { ...failed, runId, cookRun };
    }
  } catch (err) {
    return failRecipe(err);
  }
}

function isCookDirEntry(kind?: string): boolean {
  return kind === "directory" || kind === "dir";
}

export async function listCookRunsAction(
  id: string,
): Promise<{ error?: string; runs?: CookRunRecord[] }> {
  try {
    await requireL1Session();
    const listing = await ensurebox.readFile(id, ".l1/cooks");
    const entries = listing.entries ?? [];
    const runs: CookRunRecord[] = [];
    for (const entry of entries) {
      if (!isCookDirEntry(entry.kind) || !entry.name) {
        continue;
      }
      const runId = cookRunIdFromDir(`.l1/cooks/${entry.name}`);
      if (!runId) {
        continue;
      }
      try {
        const file = await ensurebox.readFile(id, cookResultRelPath(runId));
        if (file.kind === "dir" || file.encoding === "base64") {
          continue;
        }
        const parsed = parseCookRunRecord(JSON.parse(file.content || "null"));
        if (parsed) {
          runs.push({ ...parsed, boxId: id, id: parsed.id || runId });
        }
      } catch {
        // Older cook dirs may not have result.json.
      }
    }
    return { runs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|no such file|404/i.test(message)) {
      return { runs: [] };
    }
    return fail(err, "Could not list cached cooks");
  }
}

export async function deleteCookRunAction(
  id: string,
  runId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    const dir = cookArtifactDir(runId);
    if (!dir.startsWith(".l1/cooks/") || dir === ".l1/cooks") {
      return { error: "Invalid cook run." };
    }
    try {
      await ensurebox.deleteFile(id, dir, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/not found|no such file|404/i.test(message)) {
        return fail(err, "Could not delete cook files");
      }
    }
    return { ok: true };
  } catch (err) {
    return fail(err, "Could not delete cook files");
  }
}

export async function deleteCookRunsAction(
  id: string,
  runIds: string[],
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireL1Session();
    for (const runId of runIds) {
      const result = await deleteCookRunAction(id, runId);
      if (result.error) {
        return result;
      }
    }
    return { ok: true };
  } catch (err) {
    return fail(err, "Could not delete cook files");
  }
}
