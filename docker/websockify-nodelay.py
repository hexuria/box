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


def _shared_screen_without_a_token() -> None:
    """A connection with no token is the box's shared screen (BOX_VNC_SHARED, host:port), as it
    was before a Bot could have its own screen (box-screen, token s<N>): a server that does not
    know about own screens keeps reaching the shared one."""
    import os
    from urllib.parse import parse_qs, urlparse

    from websockify.websocketproxy import ProxyRequestHandler

    shared = os.environ.get("BOX_VNC_SHARED", "")
    if ":" not in shared:
        return
    host, port = shared.rsplit(":", 1)
    looked_up = ProxyRequestHandler.get_target

    def get_target(self, target_plugin):
        args = parse_qs(urlparse(self.path)[4])
        if not args.get("token") and not getattr(self, "host_token", False):
            return host, port
        return looked_up(self, target_plugin)

    ProxyRequestHandler.get_target = get_target


_shared_screen_without_a_token()

if __name__ == "__main__":
    sys.argv[0] = "websockify"
    websockify_init()
