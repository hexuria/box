export const ENSUREBOX_URL = (
  process.env.ENSUREBOX_URL?.trim() || "http://127.0.0.1:43142"
).replace(/\/$/, "");

export const ENSUREBOX_TOKEN =
  process.env.ENSUREBOX_TOKEN?.trim() || "dev-ensurebox-token";

export const FRAMEBUFFER = { width: 1280, height: 800 } as const;
