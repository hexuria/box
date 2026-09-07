"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as ensurebox from "./ensurebox";
import { EnsureboxError } from "./ensurebox";

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

export async function createBoxAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  try {
    const name = String(formData.get("name") || "").trim();
    const box = await ensurebox.createBox(name || undefined);
    revalidatePath("/");
    redirect(`/boxes/${box.id}`);
  } catch (err) {
    return fail(err);
  }
}

export async function startBoxAction(id: string) {
  await ensurebox.startBox(id);
  revalidatePath("/");
  revalidatePath(`/boxes/${id}`);
}

export async function execAction(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; result?: unknown }> {
  try {
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
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await ensurebox.click(id, x, y, 1);
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
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await ensurebox.scroll(id, { x: 640, y: 400, dx, dy });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
