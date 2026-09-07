export type BoxStatus =
  | "creating"
  | "ready"
  | "stopped"
  | "hibernated"
  | "error"
  | "destroying";

export type BoxRecord = {
  id: string;
  name: string;
  status: BoxStatus;
  image: string;
  containerName: string;
  containerId: string | null;
  boxToken: string;
  vncPassword: string;
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
};

/** JSON returned to L1 and `/api/v1`. No guest token, VNC password, or bind URLs. */
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

/** Operator console only. Host ports/volumes after login. Never sent to L1. */
export type OperatorBox = PublicBox & {
  ports: BoxRecord["ports"];
  volumes: BoxRecord["volumes"];
  endpoints: {
    exec: string;
    host: string;
    viewer: string;
  };
  vncPassword: string;
};

export type Capabilities = {
  exec: boolean;
  files: boolean;
  desktop: boolean;
  chrome: boolean;
  cua: boolean;
};
