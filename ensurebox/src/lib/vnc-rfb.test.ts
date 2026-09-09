import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptVncChallenge } from "./vnc-des.ts";
import {
  BytePump,
  completeServerRfbAuth,
  offerUnauthedRfbToClient,
} from "./vnc-rfb.ts";

const CHALLENGE = Buffer.from("0123456789abcdef");

test("VNC challenge encryption matches noVNC / d3des (not OpenSSL DES-ECB)", () => {
  assert.equal(
    encryptVncChallenge("password", CHALLENGE).toString("hex"),
    "5645abeb5f1e6475e8feb11beb66ea19",
  );
  assert.equal(
    encryptVncChallenge("ab", CHALLENGE).toString("hex"),
    "428e92393baedb1d321ae7e2cdd6ee34",
  );
  assert.equal(
    encryptVncChallenge("12345678", CHALLENGE).toString("hex"),
    "a7b25f5ece62cb54ff8253c3c9118b69",
  );
});

test("completeServerRfbAuth selects VNC auth and answers the challenge", async () => {
  const read = new BytePump();
  const writes: Buffer[] = [];
  read.push(Buffer.from("RFB 003.008\n"));
  read.push(Buffer.from([1, 2]));
  read.push(CHALLENGE);
  read.push(Buffer.alloc(4));
  await completeServerRfbAuth(read, (chunk) => writes.push(Buffer.from(chunk)), "password");
  assert.equal(writes[0]?.toString("ascii"), "RFB 003.008\n");
  assert.deepEqual([...writes[1]!], [2]);
  assert.equal(writes[2]?.toString("hex"), encryptVncChallenge("password", CHALLENGE).toString("hex"));
});

test("completeServerRfbAuth accepts security type None", async () => {
  const read = new BytePump();
  const writes: Buffer[] = [];
  read.push(Buffer.from("RFB 003.008\n"));
  read.push(Buffer.from([1, 1]));
  read.push(Buffer.alloc(4));
  await completeServerRfbAuth(read, (chunk) => writes.push(Buffer.from(chunk)), "unused");
  assert.deepEqual([...writes[1]!], [1]);
});

test("offerUnauthedRfbToClient speaks RFB 3.8 None", async () => {
  const read = new BytePump();
  const writes: Buffer[] = [];
  read.push(Buffer.from("RFB 003.008\n"));
  read.push(Buffer.from([1]));
  await offerUnauthedRfbToClient(read, (chunk) => writes.push(Buffer.from(chunk)));
  assert.equal(writes[0]?.toString("ascii"), "RFB 003.008\n");
  assert.deepEqual([...writes[1]!], [1, 1]);
  assert.equal(writes[2]?.readUInt32BE(0), 0);
});

test("BytePump close unblocks readExact", async () => {
  const pump = new BytePump();
  const pending = pump.readExact(4);
  pump.close(new Error("gone"));
  await assert.rejects(pending, /gone/);
});
