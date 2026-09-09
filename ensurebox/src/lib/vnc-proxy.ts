import WebSocket from "ws";
import { disableNagleWs } from "./vnc-nagle";
import {
  BytePump,
  completeServerRfbAuth,
  offerUnauthedRfbToClient,
} from "./vnc-rfb";

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function sendBin(socket: WebSocket, data: Buffer): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data, { binary: true });
  }
}

function closeQuiet(socket: WebSocket, code?: number, reason?: string): void {
  try {
    socket.close(code, reason);
  } catch {
    try {
      socket.terminate();
    } catch {
      // already closed
    }
  }
}

function openUpstream(url: string, timeoutMs = 10_000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const tryOpen = (protocols?: string[]) => {
      const socket = new WebSocket(url, protocols, {
        perMessageDeflate: false,
        skipUTF8Validation: true,
      });
      const timer = setTimeout(() => {
        closeQuiet(socket);
        reject(new Error("desktop upstream timed out"));
      }, timeoutMs);
      const fail = (err: Error) => {
        clearTimeout(timer);
        socket.removeAllListeners();
        closeQuiet(socket);
        reject(err);
      };
      socket.once("open", () => {
        clearTimeout(timer);
        socket.removeAllListeners("error");
        disableNagleWs(socket);
        resolve(socket);
      });
      socket.once("error", (err) => {
        if (protocols?.length) {
          clearTimeout(timer);
          socket.removeAllListeners();
          closeQuiet(socket);
          tryOpen(undefined);
          return;
        }
        fail(err instanceof Error ? err : new Error(String(err)));
      });
    };
    tryOpen(["binary"]);
  });
}

/**
 * Authenticate to the guest RFB, then present security type None to the
 * browser and splice remaining bytes.
 */
export async function proxyAuthenticatedRfb(opts: {
  client: WebSocket;
  upstreamUrl: string;
  password: string;
}): Promise<void> {
  const { client, upstreamUrl, password } = opts;
  const clientPump = new BytePump();
  const upstreamPump = new BytePump();
  let spliced = false;
  let upstream: WebSocket | null = null;

  const attach = (
    socket: WebSocket,
    pump: BytePump,
    peer: () => WebSocket | null,
  ) => {
    socket.on("message", (data) => {
      const buf = toBuffer(data);
      if (!spliced) {
        pump.push(buf);
        return;
      }
      const dest = peer();
      if (dest && dest.readyState === WebSocket.OPEN) {
        sendBin(dest, buf);
      }
    });
    socket.on("close", () => {
      pump.close(new Error("socket closed"));
      const dest = peer();
      if (dest && dest.readyState === WebSocket.OPEN) {
        closeQuiet(dest);
      }
    });
    socket.on("error", () => {
      pump.close(new Error("socket error"));
    });
  };

  attach(client, clientPump, () => upstream);

  try {
    upstream = await openUpstream(upstreamUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    closeQuiet(client, 1011, message.slice(0, 120));
    throw err;
  }

  attach(upstream, upstreamPump, () => client);

  try {
    await Promise.all([
      completeServerRfbAuth(upstreamPump, (data) => sendBin(upstream!, data), password),
      offerUnauthedRfbToClient(clientPump, (data) => sendBin(client, data)),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    closeQuiet(client, 1011, message.slice(0, 120));
    closeQuiet(upstream);
    throw err;
  }

  spliced = true;
  const leftoverUp = upstreamPump.rest();
  const leftoverClient = clientPump.rest();
  if (leftoverUp.length > 0) {
    sendBin(client, leftoverUp);
  }
  if (leftoverClient.length > 0) {
    sendBin(upstream, leftoverClient);
  }
}
