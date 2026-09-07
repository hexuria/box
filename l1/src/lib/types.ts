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

/** Public box from EnsureBox. The guest bearer token is never included. */
export type PublicBox = {
  id: string;
  name: string;
  status: BoxStatus;
  image: string;
  containerName: string;
  containerId: string | null;
  ports: {
    exec: number;
    host: number;
    novnc: number;
  };
  volumes: {
    workspace: string;
    chromeProfile: string;
  };
  createdAt: string;
  updatedAt: string;
  error: string | null;
  endpoints: {
    exec: string;
    host: string;
    viewer: string;
  };
  vncPassword: string;
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
  png_base64?: string;
  width?: number;
  height?: number;
};

export type EnsureboxErrorBody = {
  error?: {
    code?: string;
    message?: string;
    status?: number;
  };
};
