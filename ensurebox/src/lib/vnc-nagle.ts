import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";

type NagleSocket = {
  setNoDelay?: (noDelay?: boolean) => void;
};

/** Disable Nagle so small RFB pointer/key frames flush immediately. */
export function disableNagle(socket: Duplex | NagleSocket | null | undefined): void {
  try {
    const tcp = socket as NagleSocket;
    tcp.setNoDelay?.(true);
  } catch {
    // Unix sockets and already-destroyed FDs cannot take TCP_NODELAY.
  }
}

export function disableNagleWs(socket: WebSocket): void {
  disableNagle((socket as WebSocket & { _socket?: NagleSocket })._socket);
}
