import { GrokBox, GrokBoxError } from "grok-box";
import type { BoxRecord } from "./types";

export { GrokBox, GrokBoxError, GrokBoxError as BoxHttpError };

export function connectBox(box: BoxRecord): GrokBox {
  return GrokBox.connect(
    `http://127.0.0.1:${box.ports.exec}`,
    `http://127.0.0.1:${box.ports.host}`,
    box.boxToken,
  );
}

export async function waitUntilReady(box: BoxRecord, timeoutMs: number): Promise<void> {
  const client = connectBox(box);
  const started = Date.now();
  let last = "not contacted";
  while (Date.now() - started < timeoutMs) {
    try {
      await client.ready();
      return;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`box did not become ready: ${last}`);
}
