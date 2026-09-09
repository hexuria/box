/**
 * Connect-only grok-box client.
 *
 * Pass the published exec URL, host URL, and token. This package never starts
 * Docker and never treats `/v1/info` advertised URLs as the dial address.
 */

export class GrokBoxError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "GrokBoxError";
    this.status = status;
    this.body = body;
  }
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export type ExecRequest = {
  command: string[] | string;
  cwd?: string;
  timeout_ms?: number;
  env?: Record<string, string>;
  stdin?: string | null;
};

export type ExecResponse = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  truncated: boolean;
  cwd: string;
};

export type FilePutRequest = {
  path: string;
  content: string;
  encoding?: string;
  create_dirs?: boolean;
};

export type ScreenshotResponse = {
  encoding: string;
  mime: string;
  width: number;
  height: number;
  png_base64?: string;
  bytes: number;
  path?: string;
};

export type CuaOk = { ok: boolean };

export type RecipeScreenshot = "none" | "end" | "each";

export type RecipeStep =
  | { op: "click"; x: number; y: number; button?: number }
  | { op: "double_click" | "double-click"; x: number; y: number; button?: number }
  | { op: "move"; x: number; y: number }
  | { op: "press"; x: number; y: number; button?: number }
  | {
      op: "release";
      x?: number;
      y?: number;
      button?: number;
      path?: { x: number; y: number }[];
    }
  | { op: "drag"; x1: number; y1: number; x2: number; y2: number; button?: number }
  | { op: "type"; text: string }
  | { op: "key"; key: string; action?: "tap" | "down" | "up" }
  | { op: "scroll"; x: number; y: number; dx: number; dy: number }
  | { op: "wait"; ms: number }
  | { op: "screenshot" }
  | { op: "reset_desktop" | "reset" };

export type RecipeSettle = "off" | "compressed" | "raw";

export type RecipeRequest = {
  name?: string;
  stop_on_error?: boolean;
  screenshot?: RecipeScreenshot;
  record?: boolean;
  artifact_dir?: string;
  settle?: RecipeSettle;
  steps: RecipeStep[];
};

export type RecipeArtifact = {
  kind: string;
  label: string;
  path: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  step_index?: number;
};

export type RecipeStepResult = {
  index: number;
  op: string;
  ok: boolean;
  ms: number;
  error?: string;
  screenshot?: ScreenshotResponse;
};

export type RecipeResponse = {
  ok: boolean;
  name?: string;
  ran: number;
  stopped_at?: number;
  duration_ms: number;
  steps: RecipeStepResult[];
  screenshot?: ScreenshotResponse;
  artifacts?: RecipeArtifact[];
  recording_error?: string;
};

export class GrokBox {
  private constructor(
    readonly execUrl: string,
    readonly hostUrl: string,
    private readonly token: string,
  ) {}

  static connect(execUrl: string, hostUrl: string, token: string): GrokBox {
    const exec = trimSlash(execUrl);
    const host = trimSlash(hostUrl);
    if (!exec || !host || !token) {
      throw new Error("execUrl, hostUrl, and token are required");
    }
    return new GrokBox(exec, host, token);
  }

  async healthExec(): Promise<unknown> {
    return this.publicJson(`${this.execUrl}/v1/health`);
  }

  async healthHost(): Promise<unknown> {
    return this.publicJson(`${this.hostUrl}/v1/health`);
  }

  async ready(): Promise<unknown> {
    return this.authJson("GET", `${this.hostUrl}/v1/ready`);
  }

  /** Inventory only. Do not dial `endpoints` from this payload. */
  async info(): Promise<unknown> {
    return this.authJson("GET", `${this.hostUrl}/v1/info`);
  }

  async exec(request: ExecRequest, timeoutMs = 120_000): Promise<ExecResponse> {
    return this.authJson("POST", `${this.execUrl}/v1/exec`, request, timeoutMs);
  }

  async filesGet(path: string, encoding?: string): Promise<unknown> {
    const query = new URLSearchParams({ path });
    if (encoding) {
      query.set("encoding", encoding);
    }
    return this.authJson("GET", `${this.execUrl}/v1/files?${query.toString()}`);
  }

  async filesPut(request: FilePutRequest): Promise<{ path: string; bytes_written: number }> {
    return this.authJson("PUT", `${this.execUrl}/v1/files`, request);
  }

  async filesDelete(
    path: string,
    recursive = false,
  ): Promise<{ path: string; deleted: boolean }> {
    const query = new URLSearchParams({ path });
    if (recursive) {
      query.set("recursive", "true");
    }
    return this.authJson("DELETE", `${this.execUrl}/v1/files?${query.toString()}`);
  }

  async filesMkdir(
    path: string,
    parents = true,
  ): Promise<{ path: string; created: boolean }> {
    return this.authJson("POST", `${this.execUrl}/v1/files/mkdir`, { path, parents });
  }

  async filesRename(
    from: string,
    to: string,
  ): Promise<{ from: string; to: string }> {
    return this.authJson("POST", `${this.execUrl}/v1/files/rename`, { from, to });
  }

  async screenshot(): Promise<ScreenshotResponse> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/screenshot`, undefined, 60_000);
  }

  async screenshotPng(): Promise<Uint8Array> {
    const response = await this.raw("POST", `${this.execUrl}/v1/cua/screenshot?format=png`, {
      headers: { accept: "image/png" },
      timeoutMs: 60_000,
    });
    if (!response.ok) {
      const body = await parseBody(response);
      throw new GrokBoxError(`screenshot PNG returned ${response.status}`, response.status, body);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async click(x: number, y: number, button?: number): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/click`, { x, y, button });
  }

  async doubleClick(x: number, y: number, button?: number): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/double-click`, { x, y, button });
  }

  async move(x: number, y: number): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/move`, { x, y });
  }

  async drag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    button?: number,
  ): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/drag`, { x1, y1, x2, y2, button });
  }

  async press(x: number, y: number, button?: number): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/press`, { x, y, button });
  }

  async mouseDown(x: number, y: number, button?: number): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/mousedown`, { x, y, button });
  }

  async release(
    x?: number,
    y?: number,
    button?: number,
    path?: { x: number; y: number }[],
  ): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/release`, { x, y, button, path });
  }

  async mouseUp(
    x?: number,
    y?: number,
    button?: number,
    path?: { x: number; y: number }[],
  ): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/mouseup`, { x, y, button, path });
  }

  async type(text: string): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/type`, { text });
  }

  async key(key: string, action?: "tap" | "down" | "up"): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/key`, { key, action });
  }

  async scroll(x: number, y: number, dx: number, dy: number): Promise<CuaOk> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/scroll`, { x, y, dx, dy });
  }

  /** Many CUA steps in one request. The guest lints the plan before actuating. */
  async recipe(request: RecipeRequest): Promise<RecipeResponse> {
    return this.authJson("POST", `${this.execUrl}/v1/cua/recipe`, request, 120_000);
  }

  private async publicJson(url: string): Promise<unknown> {
    const response = await fetch(url, { cache: "no-store" });
    const body = await parseBody(response);
    if (!response.ok) {
      throw new GrokBoxError(`${url} returned ${response.status}`, response.status, body);
    }
    return body;
  }

  private async authJson<T>(
    method: string,
    url: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: "application/json",
    };
    const init: RequestInit = { method, headers, cache: "no-store" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await this.raw(method, url, {
      headers,
      body: init.body ?? undefined,
      timeoutMs,
    });
    const parsed = await parseBody(response);
    if (!response.ok) {
      throw new GrokBoxError(`${url} returned ${response.status}`, response.status, parsed);
    }
    return parsed as T;
  }

  private async raw(
    method: string,
    url: string,
    init: { headers?: Record<string, string>; body?: BodyInit; timeoutMs?: number },
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.token}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
    try {
      return await fetch(url, {
        method,
        headers,
        body: init.body,
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
