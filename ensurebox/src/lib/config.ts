import path from "node:path";

export const ENSUREBOX_TOKEN =
  process.env.ENSUREBOX_TOKEN?.trim() || "dev-ensurebox-token";

export const GROK_BOX_IMAGE = process.env.GROK_BOX_IMAGE?.trim() || "grok-box:local";

export const DATA_DIR = process.env.ENSUREBOX_DATA_DIR?.trim()
  ? path.resolve(/* turbopackIgnore: true */ process.env.ENSUREBOX_DATA_DIR)
  : path.join(process.cwd(), "data");

export const BIND_HOST = process.env.ENSUREBOX_BIND?.trim() || "127.0.0.1";

export const READY_TIMEOUT_MS = Number(process.env.ENSUREBOX_READY_TIMEOUT_MS || 90_000);

export const PROTOCOL_VERSION = "v1";
