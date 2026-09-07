import path from "node:path";

export const DEV_ENSUREBOX_TOKEN = "dev-ensurebox-token";
export const MIN_TOKEN_LEN = 16;

export function tokenIsInsecure(token: string, wellKnown: string[]): boolean {
  return token.length < MIN_TOKEN_LEN || wellKnown.includes(token);
}

export function requireSecretToken(
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

export const GROK_BOX_IMAGE = process.env.GROK_BOX_IMAGE?.trim() || "grok-box:local";

export const DATA_DIR = process.env.ENSUREBOX_DATA_DIR?.trim()
  ? path.resolve(/* turbopackIgnore: true */ process.env.ENSUREBOX_DATA_DIR)
  : path.join(process.cwd(), "data");

export const BIND_HOST = process.env.ENSUREBOX_BIND?.trim() || "127.0.0.1";

export const READY_TIMEOUT_MS = Number(process.env.ENSUREBOX_READY_TIMEOUT_MS || 90_000);

export const PROTOCOL_VERSION = "v1";
