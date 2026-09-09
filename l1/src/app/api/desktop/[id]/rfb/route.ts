import { NextResponse } from "next/server";
import { requireL1Session } from "@/lib/auth";
import { EnsureboxError, getBox } from "@/lib/ensurebox";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireL1Session();
  } catch {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in required", status: 401 } },
      { status: 401 },
    );
  }
  const { id } = await params;
  try {
    const box = await getBox(id);
    if (box.status !== "ready") {
      return NextResponse.json(
        {
          error: {
            code: "not_ready",
            message:
              box.status === "creating"
                ? "This workspace is still starting."
                : "Workspace is not ready.",
            status: 409,
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, protocol: "rfb", ready: true });
  } catch (err) {
    if (err instanceof EnsureboxError && err.status === 404) {
      return NextResponse.json(
        { error: { code: "not_found", message: err.message, status: 404 } },
        { status: 404 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "http_error", message, status: 502 } },
      { status: 502 },
    );
  }
}
