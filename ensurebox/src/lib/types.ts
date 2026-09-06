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

export type PublicBox = Omit<BoxRecord, "boxToken"> & {
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
