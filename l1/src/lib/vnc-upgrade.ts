import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { SESSION_COOKIE, tokensEqual } from "@/lib/auth";
import { ENSUREBOX_URL, getEnsureboxToken, tryGetL1Token } from "@/lib/config";
import { cookieValue, ensureboxVncUrl, matchDesktopRfbPath } from "@/lib/vnc-path";
import { disableNagle, disableNagleWs } from "@/lib/vnc-nagle";

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  skipUTF8Validation: true,
  handleProtocols: (protocols) => (protocols.has("binary") ? "binary" : false),
});

function deny(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function sessionOk(req: IncomingMessage): boolean {
  const loaded = tryGetL1Token();
  if ("error" in loaded) {
    return false;
  }
  const presented = cookieValue(req.headers.cookie, SESSION_COOKIE);
  return Boolean(presented) && tokensEqual(presented!, loaded.token);
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function pipeSockets(a: WebSocket, b: WebSocket): void {
  disableNagleWs(a);
  disableNagleWs(b);
  const forward = (from: WebSocket, to: WebSocket) => {
    from.on("message", (data, isBinary) => {
      if (to.readyState === WebSocket.OPEN) {
        to.send(toBuffer(data), { binary: isBinary || Buffer.isBuffer(data) });
      }
    });
    from.on("close", (code, reason) => {
      if (to.readyState === WebSocket.OPEN) {
        try {
          to.close(code, reason.toString());
        } catch {
          to.terminate();
        }
      }
    });
    from.on("error", () => {
      if (to.readyState === WebSocket.OPEN) {
        to.terminate();
      }
    });
  };
  forward(a, b);
  forward(b, a);
}

async function handleDesktopRfbUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  id: string,
): Promise<void> {
  disableNagle(socket);
  if (!sessionOk(req)) {
    deny(socket, 401, "Unauthorized");
    return;
  }

  let token: string;
  try {
    token = getEnsureboxToken();
  } catch {
    deny(socket, 503, "Misconfigured");
    return;
  }

  const upstreamUrl = ensureboxVncUrl(ENSUREBOX_URL, id);
  const upstream = new WebSocket(upstreamUrl, ["binary"], {
    perMessageDeflate: false,
    skipUTF8Validation: true,
    headers: { authorization: `Bearer ${token}` },
  });

  const opened = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      upstream.terminate();
      resolve(false);
    }, 15_000);
    upstream.once("open", () => {
      clearTimeout(timer);
      disableNagleWs(upstream);
      resolve(true);
    });
    upstream.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    upstream.once("unexpected-response", (_resReq, res) => {
      clearTimeout(timer);
      deny(socket, res.statusCode || 502, res.statusMessage || "Bad Gateway");
      upstream.terminate();
      resolve(false);
    });
  });

  if (!opened) {
    if (!socket.destroyed) {
      deny(socket, 502, "Bad Gateway");
    }
    return;
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    pipeSockets(client, upstream);
  });
}

export function installL1VncUpgrade(): void {
  const originalEmit = http.Server.prototype.emit as (
    event: string,
    ...args: unknown[]
  ) => boolean;
  http.Server.prototype.emit = function (this: http.Server, event: string, ...args: unknown[]) {
    if (event === "upgrade") {
      const req = args[0] as IncomingMessage;
      const id = matchDesktopRfbPath(req.url || "");
      if (id) {
        void handleDesktopRfbUpgrade(
          req,
          args[1] as Duplex,
          (args[2] as Buffer) || Buffer.alloc(0),
          id,
        );
        return true;
      }
    }
    return originalEmit.apply(this, [event, ...args]);
  };
  console.info(JSON.stringify({ msg: "l1.desktop.rfb.upgrade", installed: true }));
}
