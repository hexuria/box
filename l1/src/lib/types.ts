export type BoxStatus =
  | "creating"
  | "ready"
  | "stopped"
  | "hibernated"
  | "error"
  | "destroying";

export type Capabilities = {
  exec: boolean;
  files: boolean;
  desktop: boolean;
  chrome: boolean;
  cua: boolean;
};

/** Public box from EnsureBox. Guest secrets and bind URLs are never included. */
export type PublicBox = {
  id: string;
  name: string;
  status: BoxStatus;
  image: string;
  containerName: string;
  containerId: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};

export type EnsureboxHealth = {
  status: string;
  service: string;
  protocol: string;
  version: string;
};

export type ReadyResponse = {
  status: string;
  box_id: string;
  box_status: BoxStatus;
};

export type ExecResult = {
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  timed_out?: boolean;
};

export type FileResult = {
  path?: string;
  content?: string;
  encoding?: string;
};

export type ScreenshotResult = {
  encoding?: string;
  mime?: string;
  png_base64?: string;
  width?: number;
  height?: number;
  bytes?: number;
};

export type RecipeScreenshotMode = "none" | "end" | "each";

export type RecipeRequest = {
  name?: string;
  stop_on_error?: boolean;
  screenshot?: RecipeScreenshotMode;
  steps: unknown[];
};

export type RecipeStepResult = {
  index?: number;
  op?: string;
  ok?: boolean;
  ms?: number;
  error?: string;
  screenshot?: ScreenshotResult;
};

/** Guest `POST /v1/cua/recipe` receipt (optional screenshot PNG on the body or a step). */
export type RecipeReceipt = {
  ok?: boolean;
  name?: string;
  ran?: number;
  stopped_at?: number;
  duration_ms?: number;
  steps?: RecipeStepResult[];
  screenshot?: ScreenshotResult;
};

export type EnsureboxErrorBody = {
  error?: {
    code?: string;
    message?: string;
    status?: number;
  };
};
