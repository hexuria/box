#!/usr/bin/env python3
"""websockify with TCP_NODELAY so small RFB pointer/key frames are not delayed by Nagle."""
from __future__ import annotations

import socket
import sys

from websockify.websocketproxy import websockify_init


def _nodelay(sock: socket.socket) -> None:
    try:
        if sock.type == socket.SOCK_STREAM:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:
        pass


_OrigSocket = socket.socket


class _NoDelaySocket(_OrigSocket):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        _nodelay(self)

    def accept(self):
        conn, addr = super().accept()
        _nodelay(conn)
        return conn, addr


socket.socket = _NoDelaySocket  # type: ignore[misc]

if __name__ == "__main__":
    sys.argv[0] = "websockify"
    websockify_init()
