#!/usr/bin/env node
/**
 * Prove EnsureBox /api/v1/boxes/:id/vnc is an authenticated RFB WebSocket
 * that speaks security type None (password stays on the server) and reports
 * the 1280×800 framebuffer.
 */
import WebSocket from "ws";

const [base, token, id] = process.argv.slice(2);
if (!base || !token || !id) {
  console.error("usage: vnc-rfb-smoke.mjs <ensurebox-base> <token> <box-id>");
  process.exit(2);
}

const url = new URL(`/api/v1/boxes/${encodeURIComponent(id)}/vnc`, base);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

await new Promise((resolve, reject) => {
  const ws = new WebSocket(url, ["binary"], {
    headers: { authorization: `Bearer ${token}` },
    perMessageDeflate: false,
  });
  let buf = Buffer.alloc(0);
  let state = "version";
  const timer = setTimeout(() => {
    ws.terminate();
    reject(new Error("RFB smoke timed out"));
  }, 15_000);

  const fail = (err) => {
    clearTimeout(timer);
    try {
      ws.terminate();
    } catch {
      // ignore
    }
    reject(err instanceof Error ? err : new Error(String(err)));
  };

  const take = (n) => {
    if (buf.length < n) {
      return null;
    }
    const got = buf.subarray(0, n);
    buf = buf.subarray(n);
    return got;
  };

  ws.on("unexpected-response", (_req, res) => {
    fail(new Error(`unexpected HTTP ${res.statusCode}`));
  });
  ws.on("error", fail);
  ws.on("message", (data) => {
    buf = Buffer.concat([buf, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
    try {
      while (true) {
        if (state === "version") {
          const version = take(12);
          if (!version) {
            return;
          }
          if (!version.toString("ascii").startsWith("RFB ")) {
            fail(new Error(`not RFB: ${JSON.stringify(version.toString("ascii"))}`));
            return;
          }
          ws.send(Buffer.from("RFB 003.008\n"), { binary: true });
          state = "types";
          continue;
        }
        if (state === "types") {
          if (buf.length < 1) {
            return;
          }
          const n = buf[0];
          const body = take(1 + n);
          if (!body) {
            return;
          }
          const types = [...body.subarray(1)];
          if (!types.includes(1)) {
            fail(new Error(`expected security None, got ${types.join(",")}`));
            return;
          }
          ws.send(Buffer.from([1]), { binary: true });
          state = "status";
          continue;
        }
        if (state === "status") {
          const statusBuf = take(4);
          if (!statusBuf) {
            return;
          }
          const status = statusBuf.readUInt32BE(0);
          if (status !== 0) {
            fail(new Error(`RFB security status ${status}`));
            return;
          }
          ws.send(Buffer.from([1]), { binary: true });
          state = "init";
          continue;
        }
        if (state === "init") {
          const init = take(24);
          if (!init) {
            return;
          }
          const width = init.readUInt16BE(0);
          const height = init.readUInt16BE(2);
          if (width !== 1280 || height !== 800) {
            fail(new Error(`framebuffer ${width}x${height}`));
            return;
          }
          clearTimeout(timer);
          ws.close();
          console.log(`rfb ok ${width}x${height} none`);
          resolve(undefined);
          return;
        }
        return;
      }
    } catch (err) {
      fail(err);
    }
  });
});
