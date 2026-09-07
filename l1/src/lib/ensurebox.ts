import { ENSUREBOX_URL, getEnsureboxToken } from "./config";
import type {
  Capabilities,
  EnsureboxErrorBody,
  EnsureboxHealth,
  ExecResult,
  FileResult,
  PublicBox,
  ReadyResponse,
  ScreenshotResult,
} from "./types";

/**
 * L1 talks only to EnsureBox (L2) over HTTP.
 * It never calls guest daemons, never holds the guest bearer token, and never SSH.
 */
const API_PREFIX = "/api/v1/";

export class EnsureboxError extends Error {
  status: number;
  code: string;
  body: EnsureboxErrorBody | null;

  constructor(
    message: string,
    status: number,
    code: string,
    body: EnsureboxErrorBody | null = null,
  ) {
    super(message);
    this.name = "EnsureboxError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function apiUrl(path: string): string {
  if (!path.startsWith(API_PREFIX)) {
    throw new Error("L1 may only request EnsureBox /api/v1/* paths");
  }
  return `${ENSUREBOX_URL}${path}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) {
    headers.set("authorization", `Bearer ${getEnsureboxToken()}`);
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new EnsureboxError(
        `EnsureBox timed out after ${timeoutMs}ms (${ENSUREBOX_URL})`,
        504,
        "timeout",
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new EnsureboxError(
      `EnsureBox is not reachable at ${ENSUREBOX_URL}: ${message}`,
      503,
      "unreachable",
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await parseBody(response);
  if (!response.ok) {
    const envelope = (body ?? {}) as EnsureboxErrorBody;
    const message =
      envelope.error?.message ||
      (typeof body === "string" ? body : `EnsureBox HTTP ${response.status}`);
    throw new EnsureboxError(
      message,
      response.status,
      envelope.error?.code || "http_error",
      envelope,
    );
  }
  return body as T;
}

export async function pingHealth(): Promise<EnsureboxHealth> {
  return request<EnsureboxHealth>("/api/v1/health", { method: "GET" }, 5_000);
}

export async function listBoxes(): Promise<PublicBox[]> {
  const data = await request<{ boxes: PublicBox[] }>("/api/v1/boxes");
  return data.boxes ?? [];
}

export async function createBox(name?: string): Promise<PublicBox> {
  return request<PublicBox>(
    "/api/v1/boxes",
    {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    },
    120_000,
  );
}

export async function getBox(id: string): Promise<PublicBox> {
  return request<PublicBox>(`/api/v1/boxes/${id}`);
}

export async function destroyBox(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/v1/boxes/${id}`, { method: "DELETE" });
}

export async function getReady(id: string): Promise<ReadyResponse> {
  return request<ReadyResponse>(`/api/v1/boxes/${id}/ready`);
}

export async function getInfo(id: string): Promise<{ capabilities?: Capabilities }> {
  return request<{ capabilities?: Capabilities }>(`/api/v1/boxes/${id}/info`);
}

export async function startBox(id: string): Promise<PublicBox> {
  return request<PublicBox>(
    `/api/v1/boxes/${id}/start`,
    { method: "POST" },
    120_000,
  );
}

export async function stopBox(id: string): Promise<PublicBox> {
  return request<PublicBox>(`/api/v1/boxes/${id}/stop`, { method: "POST" });
}

export async function hibernateBox(id: string): Promise<PublicBox> {
  return request<PublicBox>(`/api/v1/boxes/${id}/hibernate`, { method: "POST" });
}

export async function execCommand(
  id: string,
  command: string,
): Promise<ExecResult> {
  return request<ExecResult>(`/api/v1/boxes/${id}/exec`, {
    method: "POST",
    body: JSON.stringify({ command }),
  });
}

export async function readFile(id: string, filePath: string): Promise<FileResult> {
  const query = new URLSearchParams({ path: filePath });
  return request<FileResult>(`/api/v1/boxes/${id}/files?${query.toString()}`);
}

export async function writeFile(
  id: string,
  filePath: string,
  content: string,
): Promise<FileResult> {
  return request<FileResult>(`/api/v1/boxes/${id}/files`, {
    method: "PUT",
    body: JSON.stringify({ path: filePath, content }),
  });
}

export async function screenshot(id: string): Promise<ScreenshotResult> {
  return request<ScreenshotResult>(
    `/api/v1/boxes/${id}/cua/screenshot`,
    { method: "POST" },
    90_000,
  );
}

export async function click(
  id: string,
  x: number,
  y: number,
  button = 1,
): Promise<unknown> {
  return request(`/api/v1/boxes/${id}/cua/click`, {
    method: "POST",
    body: JSON.stringify({ x, y, button }),
  });
}

export async function typeText(id: string, text: string): Promise<unknown> {
  return request(`/api/v1/boxes/${id}/cua/type`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function sendKey(id: string, key: string): Promise<unknown> {
  return request(`/api/v1/boxes/${id}/cua/key`, {
    method: "POST",
    body: JSON.stringify({ key }),
  });
}

export async function scroll(
  id: string,
  body: { x: number; y: number; dx: number; dy: number },
): Promise<unknown> {
  return request(`/api/v1/boxes/${id}/cua/scroll`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function runRecipe(
  id: string,
  body: {
    name?: string;
    stop_on_error?: boolean;
    screenshot?: "none" | "end" | "each";
    steps: unknown[];
  },
): Promise<unknown> {
  return request(`/api/v1/boxes/${id}/cua/recipe`, {
    method: "POST",
    body: JSON.stringify(body),
  }, 120_000);
}

export type ConnectionStatus = {
  url: string;
  reachable: boolean;
  authorized: boolean | null;
  message: string;
  protocol: string | null;
};

export async function connectionStatus(): Promise<ConnectionStatus> {
  try {
    getEnsureboxToken();
  } catch (err) {
    return {
      url: ENSUREBOX_URL,
      reachable: false,
      authorized: null,
      protocol: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    const health = await pingHealth();
    try {
      await listBoxes();
      return {
        url: ENSUREBOX_URL,
        reachable: true,
        authorized: true,
        protocol: health.protocol ?? null,
        message: `EnsureBox ${health.version ?? ""} is reachable and accepted this client's token.`.trim(),
      };
    } catch (err) {
      if (err instanceof EnsureboxError && err.status === 401) {
        return {
          url: ENSUREBOX_URL,
          reachable: true,
          authorized: false,
          protocol: health.protocol ?? null,
          message:
            "EnsureBox rejected this client's token. Set ENSUREBOX_TOKEN to match L2.",
        };
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      url: ENSUREBOX_URL,
      reachable: false,
      authorized: null,
      protocol: null,
      message,
    };
  }
}
