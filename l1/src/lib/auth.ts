import { cookies } from "next/headers";
import { getL1Token, tryGetL1Token } from "./config";

export const SESSION_COOKIE = "l1_session";

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

export async function isL1Authed(): Promise<boolean> {
  const loaded = tryGetL1Token();
  if ("error" in loaded) {
    return false;
  }
  const jar = await cookies();
  const presented = jar.get(SESSION_COOKIE)?.value?.trim();
  return Boolean(presented) && tokensEqual(presented!, loaded.token);
}

export async function requireL1Session(): Promise<void> {
  if (!(await isL1Authed())) {
    throw new Error("Sign in required");
  }
}

export function loginMatches(presented: string): boolean {
  return tokensEqual(presented, getL1Token());
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
