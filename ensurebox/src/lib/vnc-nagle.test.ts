import assert from "node:assert/strict";
import { test } from "node:test";
import { disableNagle } from "./vnc-nagle.ts";

test("disableNagle sets TCP_NODELAY when the socket supports it", () => {
  const calls: boolean[] = [];
  disableNagle({
    setNoDelay(noDelay?: boolean) {
      calls.push(noDelay !== false);
    },
  });
  assert.deepEqual(calls, [true]);
});

test("disableNagle ignores sockets without setNoDelay", () => {
  disableNagle({});
  disableNagle(null);
});
