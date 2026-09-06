import type { BoxRecord } from "./types";

export class BoxHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "BoxHttpError";
  }
}

async function boxFetch(
  box: BoxRecord,
  port: number,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
  auth = true,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (auth) {
    headers.set("authorization", `Bearer ${box.boxToken}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function boxJson<T>(
  box: BoxRecord,
  port: number,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const response = await boxFetch(box, port, path, init, timeoutMs);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new BoxHttpError(
      `box ${path} returned ${response.status}`,
      response.status,
      body,
    );
  }
  return body as T;
}

export async function waitUntilReady(box: BoxRecord, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let last = "not contacted";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${box.ports.host}/v1/ready`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
      last = `HTTP ${response.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`box did not become ready: ${last}`);
}
