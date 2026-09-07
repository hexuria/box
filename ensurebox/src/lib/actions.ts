"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BoxHttpError } from "./box-client";
import { createBox, destroyBox, startBox, stopBox } from "./lifecycle";

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
  if (err instanceof BoxHttpError) {
    const body = err.body as { error?: { message?: string } };
    return { error: body?.error?.message || err.message };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}

export async function createBoxAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  try {
    const name = String(formData.get("name") || "").trim();
    const box = await createBox(name || undefined);
    revalidatePath("/");
    redirect(`/boxes/${box.id}`);
  } catch (err) {
    return fail(err);
  }
}

export async function stopBoxAction(id: string, hibernate = false) {
  await stopBox(id, hibernate);
  revalidatePath("/");
  revalidatePath(`/boxes/${id}`);
}

export async function startBoxAction(id: string) {
  await startBox(id);
  revalidatePath("/");
  revalidatePath(`/boxes/${id}`);
}

export async function destroyBoxAction(id: string) {
  await destroyBox(id);
  revalidatePath("/");
  redirect("/");
}
