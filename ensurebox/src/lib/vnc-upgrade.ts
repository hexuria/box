import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { bearerToken, tokensEqual } from "@/lib/auth";
import { getEnsureboxToken, tryGetEnsureboxToken } from "@/lib/config";
import { boxVncUpstream } from "@/lib/lifecycle";
import { proxyAuthenticatedRfb } from "@/lib/vnc-proxy";
import { matchEnsureboxVncPath } from "@/lib/vnc-path";
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

function authorized(req: IncomingMessage): boolean {
  const loaded = tryGetEnsureboxToken();
  if ("error" in loaded) {
    return false;
  }
  const presented = bearerToken(req.headers.authorization ?? null);
  if (!presented) {
    return false;
  }
  try {
    return tokensEqual(presented, getEnsureboxToken());
  } catch {
    return false;
  }
}

async function handleEnsureboxVncUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  id: string,
): Promise<void> {
  disableNagle(socket);
  if (!authorized(req)) {
    deny(socket, 401, "Unauthorized");
    return;
  }

  let upstream;
  try {
    upstream = await boxVncUpstream(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 409;
    deny(socket, status, message.replace(/[^\x20-\x7e]/g, " ").slice(0, 80) || "Conflict");
    return;
  }

  wss.handleUpgrade(req, socket, head, (client: WebSocket) => {
    disableNagleWs(client);
    void proxyAuthenticatedRfb({
      client,
      upstreamUrl: upstream.url,
      password: upstream.password,
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.info(JSON.stringify({ msg: "ensurebox.vnc.proxy", id, error: message }));
    });
  });
}

export function installEnsureboxVncUpgrade(): void {
  const originalEmit = http.Server.prototype.emit as (
    event: string,
    ...args: unknown[]
  ) => boolean;
  http.Server.prototype.emit = function (this: http.Server, event: string, ...args: unknown[]) {
    if (event === "upgrade") {
      const req = args[0] as IncomingMessage;
      const id = matchEnsureboxVncPath(req.url || "");
      if (id) {
        void handleEnsureboxVncUpgrade(
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
  console.info(JSON.stringify({ msg: "ensurebox.vnc.upgrade", installed: true }));
}
