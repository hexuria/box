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
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  timed_out?: boolean;
  duration_ms?: number;
  cwd?: string;
  truncated?: boolean;
  output_complete?: boolean;
};

export type DirEntry = {
  name: string;
  kind: string;
  size?: number | null;
};

export type FileResult = {
  kind?: string;
  path?: string;
  content?: string;
  encoding?: string;
  size?: number;
  entries?: DirEntry[];
  bytes_written?: number;
  deleted?: boolean;
  created?: boolean;
  from?: string;
  to?: string;
};

export type ScreenshotResult = {
  encoding?: string;
  mime?: string;
  png_base64?: string;
  width?: number;
  height?: number;
  bytes?: number;
  path?: string;
};

export type RecipeScreenshotMode = "none" | "end" | "each";

export type RecipeRequest = {
  name?: string;
  stop_on_error?: boolean;
  screenshot?: RecipeScreenshotMode;
  record?: boolean;
  artifact_dir?: string;
  settle?: "off" | "compressed" | "raw";
  /** What the receipt reports about the desktop. Default `off` costs nothing. */
  observe?: "off" | "input" | "page";
  steps: unknown[];
};

export type RecipeArtifact = {
  kind?: string;
  label?: string;
  path?: string;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  step_index?: number;
};

export type ObservedWindow = {
  id?: string;
  class?: string;
  title?: string;
};

/**
 * What the guest saw around one step. A missing field means it looked and got
 * no answer; a missing `observed` means it did not look.
 */
export type StepObservation = {
  target?: ObservedWindow;
  focus?: {
    state?: "none" | "pointer_root" | "root" | "window";
    window?: ObservedWindow;
  };
  url_before?: string;
  url_after?: string;
  observe_ms?: number;
};

export type RecipeStepResult = {
  index?: number;
  op?: string;
  /** No error was returned. Not a claim the step achieved anything. */
  ok?: boolean;
  ms?: number;
  error?: string;
  screenshot?: ScreenshotResult;
  observed?: StepObservation;
};

/** Guest `POST /v1/cua/recipe` receipt (optional screenshot PNG on the body or a step). */
export type RecipeReceipt = {
  ok?: boolean;
  name?: string;
  /** Echoed from the request, absent when it was `off`. */
  observe?: "input" | "page";
  ran?: number;
  stopped_at?: number;
  duration_ms?: number;
  steps?: RecipeStepResult[];
  screenshot?: ScreenshotResult;
  artifacts?: RecipeArtifact[];
  recording_error?: string;
};

export type EnsureboxErrorBody = {
  error?: {
    code?: string;
    message?: string;
    status?: number;
  };
};
