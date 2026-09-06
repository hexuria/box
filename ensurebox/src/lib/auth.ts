import { NextResponse } from "next/server";
import { ENSUREBOX_TOKEN } from "./config";

function tokensEqual(a: string, b: string): boolean {
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

export function requireEnsureboxToken(request: Request): NextResponse | null {
  const presented = bearerToken(request.headers.get("authorization"));
  if (!presented || !tokensEqual(presented, ENSUREBOX_TOKEN)) {
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
  return null;
}
