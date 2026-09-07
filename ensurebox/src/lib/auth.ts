import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getEnsureboxToken, tryGetEnsureboxToken } from "./config";

export const SESSION_COOKIE = "ensurebox_session";

export function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function bearerToken(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const [scheme, value] = header.split(" ");
  if (!scheme || !value || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return value;
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "unauthorized",
        message: "missing or invalid bearer token",
        status: 401,
      },
    },
    { status: 401 },
  );
}

export function requireEnsureboxToken(request: Request): NextResponse | null {
  const loaded = tryGetEnsureboxToken();
  if ("error" in loaded) {
    return NextResponse.json(
      {
        error: {
          code: "misconfigured",
          message: loaded.error,
          status: 503,
        },
      },
      { status: 503 },
    );
  }
  const presented = bearerToken(request.headers.get("authorization"));
  if (!presented || !tokensEqual(presented, loaded.token)) {
    return unauthorized();
  }
  return null;
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value?.trim();
  return value || null;
}

export async function isOperatorAuthed(): Promise<boolean> {
  const loaded = tryGetEnsureboxToken();
  if ("error" in loaded) {
    return false;
  }
  const presented = await readSessionToken();
  return presented != null && tokensEqual(presented, loaded.token);
}

export async function requireOperatorSession(): Promise<void> {
  if (!(await isOperatorAuthed())) {
    throw new Error("Sign in required");
  }
}

export function sessionCookieOptions(token: string): {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: "lax";
  path: string;
  secure: boolean;
} {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
  };
}

export function loginMatches(presented: string): boolean {
  const expected = getEnsureboxToken();
  return tokensEqual(presented, expected);
}
