export const DEV_L1_TOKEN = "dev-l1-token";
export const DEV_ENSUREBOX_TOKEN = "dev-ensurebox-token";
export const MIN_TOKEN_LEN = 16;

export const ENSUREBOX_URL = (
  process.env.ENSUREBOX_URL?.trim() || "http://127.0.0.1:43142"
).replace(/\/$/, "");

export const FRAMEBUFFER = { width: 1280, height: 800 } as const;

function tokenIsInsecure(token: string, wellKnown: string[]): boolean {
  return token.length < MIN_TOKEN_LEN || wellKnown.includes(token);
}

function requireSecretToken(
  name: string,
  raw: string | undefined,
  allowInsecureEnv: string,
  wellKnown: string[],
): string {
  const token = raw?.trim() ?? "";
  if (!token) {
    throw new Error(`${name} must be set and non-empty`);
  }
  if (tokenIsInsecure(token, wellKnown) && process.env[allowInsecureEnv] !== "1") {
    throw new Error(
      `${name} is shorter than ${MIN_TOKEN_LEN} characters or a well-known demo value. Set a long random token, or ${allowInsecureEnv}=1 for a local loopback demo.`,
    );
  }
  return token;
}

export function getL1Token(): string {
  return requireSecretToken("L1_TOKEN", process.env.L1_TOKEN, "L1_ALLOW_INSECURE_DEV", [
    DEV_L1_TOKEN,
  ]);
}

export function tryGetL1Token(): { token: string } | { error: string } {
  try {
    return { token: getL1Token() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function getEnsureboxToken(): string {
  return requireSecretToken(
    "ENSUREBOX_TOKEN",
    process.env.ENSUREBOX_TOKEN,
    "ENSUREBOX_ALLOW_INSECURE_DEV",
    [DEV_ENSUREBOX_TOKEN],
  );
}

export function tryGetEnsureboxToken(): { token: string } | { error: string } {
  try {
    return { token: getEnsureboxToken() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
