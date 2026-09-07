import { NextResponse } from "next/server";
import { loginMatches, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { tryGetL1Token } from "@/lib/config";

export const dynamic = "force-dynamic";

async function readToken(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    return typeof body?.token === "string" ? body.token : "";
  }
  const form = await request.formData().catch(() => null);
  return form ? String(form.get("token") || "") : "";
}

export async function POST(request: Request) {
  const loaded = tryGetL1Token();
  if ("error" in loaded) {
    return NextResponse.json(
      { error: { code: "misconfigured", message: loaded.error, status: 503 } },
      { status: 503 },
    );
  }
  const presented = await readToken(request);
  if (!loginMatches(presented)) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "missing or invalid token",
          status: 401,
        },
      },
      { status: 401 },
    );
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieOptions(presented));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
