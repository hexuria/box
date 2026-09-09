/*
 * DES-ECB for RFB VNC authentication. Ported from noVNC's Acme.Crypto DES
 * (core/crypto/des.js), which already uses the VNC password bit order so
 * callers pass the padded password bytes without an extra bit reversal.
 *
 * Original notices:
 *   Copyright (C) 1999 AT&T Laboratories Cambridge.  All Rights Reserved.
 *   Copyright (c) 1996 Widget Workshop, Inc. All Rights Reserved.
 *   Copyright (C) 1996 by Jef Poskanzer <jef@acme.com>.  All rights reserved.
 */

const PC2 = [
  13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26,
  19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33,
  52, 45, 41, 49, 35, 28, 31,
];
const totrot = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28];

const z = 0x0;
const a1 = 1 << 16;
const b1 = 1 << 24;
const c1 = a1 | b1;
const d1 = 1 << 2;
const e1 = 1 << 10;
const f1 = d1 | e1;
const SP1 = [
  c1 | e1, z | z, a1 | z, c1 | f1, c1 | d1, a1 | f1, z | d1, a1 | z, z | e1, c1 | e1,
  c1 | f1, z | e1, b1 | f1, c1 | d1, b1 | z, z | d1, z | f1, b1 | e1, b1 | e1, a1 | e1,
  a1 | e1, c1 | z, c1 | z, b1 | f1, a1 | d1, b1 | d1, b1 | d1, a1 | d1, z | z, z | f1,
  a1 | f1, b1 | z, a1 | z, c1 | f1, z | d1, c1 | z, c1 | e1, b1 | z, b1 | z, z | e1,
  c1 | d1, a1 | z, a1 | e1, b1 | d1, z | e1, z | d1, b1 | f1, a1 | f1, c1 | f1, a1 | d1,
  c1 | z, b1 | f1, b1 | d1, z | f1, a1 | f1, c1 | e1, z | f1, b1 | e1, b1 | e1, z | z,
  a1 | d1, a1 | e1, z | z, c1 | d1,
];
const a2 = 1 << 20;
const b2 = 1 << 31;
const c2 = a2 | b2;
const d2 = 1 << 5;
const e2 = 1 << 15;
const f2 = d2 | e2;
const SP2 = [
  c2 | f2, b2 | e2, z | e2, a2 | f2, a2 | z, z | d2, c2 | d2, b2 | f2, b2 | d2, c2 | f2,
  c2 | e2, b2 | z, b2 | e2, a2 | z, z | d2, c2 | d2, a2 | e2, a2 | d2, b2 | f2, z | z,
  b2 | z, z | e2, a2 | f2, c2 | z, a2 | d2, b2 | d2, z | z, a2 | e2, z | f2, c2 | e2,
  c2 | z, z | f2, z | z, a2 | f2, c2 | d2, a2 | z, b2 | f2, c2 | z, c2 | e2, z | e2,
  c2 | z, b2 | e2, z | d2, c2 | f2, a2 | f2, z | d2, z | e2, b2 | z, z | f2, c2 | e2,
  a2 | z, b2 | d2, a2 | d2, b2 | f2, b2 | d2, a2 | d2, a2 | e2, z | z, b2 | e2, z | f2,
  b2 | z, c2 | d2, c2 | f2, a2 | e2,
];
const a3 = 1 << 17;
const b3 = 1 << 27;
const c3 = a3 | b3;
const d3 = 1 << 3;
const e3 = 1 << 9;
const f3 = d3 | e3;
const SP3 = [
  z | f3, c3 | e3, z | z, c3 | d3, b3 | e3, z | z, a3 | f3, b3 | e3, a3 | d3, b3 | d3,
  b3 | d3, a3 | z, c3 | f3, a3 | d3, c3 | z, z | f3, b3 | z, z | d3, c3 | e3, z | e3,
  a3 | e3, c3 | z, c3 | d3, a3 | f3, b3 | f3, a3 | e3, a3 | z, b3 | f3, z | d3, c3 | f3,
  z | e3, b3 | z, c3 | e3, b3 | z, a3 | d3, z | f3, a3 | z, c3 | e3, b3 | e3, z | z,
  z | e3, a3 | d3, c3 | f3, b3 | e3, b3 | d3, z | e3, z | z, c3 | d3, b3 | f3, a3 | z,
  b3 | z, c3 | f3, z | d3, a3 | f3, a3 | e3, b3 | d3, c3 | z, b3 | f3, z | f3, c3 | z,
  a3 | f3, z | d3, c3 | d3, a3 | e3,
];
const a4 = 1 << 13;
const b4 = 1 << 23;
const c4 = a4 | b4;
const d4 = 1 << 0;
const e4 = 1 << 7;
const f4 = d4 | e4;
const SP4 = [
  c4 | d4, a4 | f4, a4 | f4, z | e4, c4 | e4, b4 | f4, b4 | d4, a4 | d4, z | z, c4 | z,
  c4 | z, c4 | f4, z | f4, z | z, b4 | e4, b4 | d4, z | d4, a4 | z, b4 | z, c4 | d4,
  z | e4, b4 | z, a4 | d4, a4 | e4, b4 | f4, z | d4, a4 | e4, b4 | e4, a4 | z, c4 | e4,
  c4 | f4, z | f4, b4 | e4, b4 | d4, c4 | z, c4 | f4, z | f4, z | z, z | z, c4 | z,
  a4 | e4, b4 | e4, b4 | f4, z | d4, c4 | d4, a4 | f4, a4 | f4, z | e4, c4 | f4, z | f4,
  z | d4, a4 | z, b4 | d4, a4 | d4, c4 | e4, b4 | f4, a4 | d4, a4 | e4, b4 | z, c4 | d4,
  z | e4, b4 | z, a4 | z, c4 | e4,
];
const a5 = 1 << 25;
const b5 = 1 << 30;
const c5 = a5 | b5;
const d5 = 1 << 8;
const e5 = 1 << 19;
const f5 = d5 | e5;
const SP5 = [
  z | d5, a5 | f5, a5 | e5, c5 | d5, z | e5, z | d5, b5 | z, a5 | e5, b5 | f5, z | e5,
  a5 | d5, b5 | f5, c5 | d5, c5 | e5, z | f5, b5 | z, a5 | z, b5 | e5, b5 | e5, z | z,
  b5 | d5, c5 | f5, c5 | f5, a5 | d5, c5 | e5, b5 | d5, z | z, c5 | z, a5 | f5, a5 | z,
  c5 | z, z | f5, z | e5, c5 | d5, z | d5, a5 | z, b5 | z, a5 | e5, c5 | d5, b5 | f5,
  a5 | d5, b5 | z, c5 | e5, a5 | f5, b5 | f5, z | d5, a5 | z, c5 | e5, c5 | f5, z | f5,
  c5 | z, c5 | f5, a5 | e5, z | z, b5 | e5, c5 | z, z | f5, a5 | d5, b5 | d5, z | e5,
  z | z, b5 | e5, a5 | f5, b5 | d5,
];
const a6 = 1 << 22;
const b6 = 1 << 29;
const c6 = a6 | b6;
const d6 = 1 << 4;
const e6 = 1 << 14;
const f6 = d6 | e6;
const SP6 = [
  b6 | d6, c6 | z, z | e6, c6 | f6, c6 | z, z | d6, c6 | f6, a6 | z, b6 | e6, a6 | f6,
  a6 | z, b6 | d6, a6 | d6, b6 | e6, b6 | z, z | f6, z | z, a6 | d6, b6 | f6, z | e6,
  a6 | e6, b6 | f6, z | d6, c6 | d6, c6 | d6, z | z, a6 | f6, c6 | e6, z | f6, a6 | e6,
  c6 | e6, b6 | z, b6 | e6, z | d6, c6 | d6, a6 | e6, c6 | f6, a6 | z, z | f6, b6 | d6,
  a6 | z, b6 | e6, b6 | z, z | f6, b6 | d6, c6 | f6, a6 | e6, c6 | z, a6 | f6, c6 | e6,
  z | z, c6 | d6, z | d6, z | e6, c6 | z, a6 | f6, z | e6, a6 | d6, b6 | f6, z | z,
  c6 | e6, b6 | z, a6 | d6, b6 | f6,
];
const a7 = 1 << 21;
const b7 = 1 << 26;
const c7 = a7 | b7;
const d7 = 1 << 1;
const e7 = 1 << 11;
const f7 = d7 | e7;
const SP7 = [
  a7 | z, c7 | d7, b7 | f7, z | z, z | e7, b7 | f7, a7 | f7, c7 | e7, c7 | f7, a7 | z,
  z | z, b7 | d7, z | d7, b7 | z, c7 | d7, z | f7, b7 | e7, a7 | f7, a7 | d7, b7 | e7,
  b7 | d7, c7 | z, c7 | e7, a7 | d7, c7 | z, z | e7, z | f7, c7 | f7, a7 | e7, z | d7,
  b7 | z, a7 | e7, b7 | z, a7 | e7, a7 | z, b7 | f7, b7 | f7, c7 | d7, c7 | d7, z | d7,
  a7 | d7, b7 | z, b7 | e7, a7 | z, c7 | e7, z | f7, a7 | f7, c7 | e7, z | f7, b7 | d7,
  c7 | f7, c7 | z, a7 | e7, z | z, z | d7, c7 | f7, z | z, a7 | f7, c7 | z, z | e7,
  b7 | d7, b7 | e7, z | e7, a7 | d7,
];
const a8 = 1 << 18;
const b8 = 1 << 28;
const c8 = a8 | b8;
const d8 = 1 << 6;
const e8 = 1 << 12;
const f8 = d8 | e8;
const SP8 = [
  b8 | f8, z | e8, a8 | z, c8 | f8, b8 | z, b8 | f8, z | d8, b8 | z, a8 | d8, c8 | z,
  c8 | f8, a8 | e8, c8 | e8, a8 | f8, z | e8, z | d8, c8 | z, b8 | d8, b8 | e8, z | f8,
  a8 | e8, a8 | d8, c8 | d8, c8 | e8, z | f8, z | z, z | z, c8 | d8, b8 | d8, b8 | e8,
  a8 | f8, a8 | z, a8 | f8, a8 | z, c8 | e8, z | e8, z | d8, c8 | d8, z | e8, a8 | f8,
  b8 | e8, z | d8, b8 | d8, c8 | z, c8 | d8, b8 | z, a8 | z, b8 | f8, z | z, c8 | f8,
  a8 | d8, b8 | d8, c8 | z, b8 | e8, b8 | f8, z | z, c8 | f8, a8 | e8, a8 | e8, z | f8,
  z | f8, a8 | d8, b8 | z, c8 | e8,
];

class DES {
  keys: number[] = [];

  constructor(password: Uint8Array) {
    const pc1m: number[] = [];
    const pcr: number[] = [];
    const kn: number[] = [];

    for (let j = 0, l = 56; j < 56; ++j, l -= 8) {
      l += l < -5 ? 65 : l < -3 ? 31 : l < -1 ? 63 : l === 27 ? 35 : 0;
      const m = l & 0x7;
      pc1m[j] = (password[l >>> 3] & (1 << m)) !== 0 ? 1 : 0;
    }

    for (let i = 0; i < 16; ++i) {
      const m = i << 1;
      const n = m + 1;
      kn[m] = kn[n] = 0;
      for (let o = 28; o < 59; o += 28) {
        for (let j = o - 28; j < o; ++j) {
          const l = j + totrot[i];
          pcr[j] = l < o ? pc1m[l] : pc1m[l - 28];
        }
      }
      for (let j = 0; j < 24; ++j) {
        if (pcr[PC2[j]] !== 0) {
          kn[m] |= 1 << (23 - j);
        }
        if (pcr[PC2[j + 24]] !== 0) {
          kn[n] |= 1 << (23 - j);
        }
      }
    }

    for (let i = 0, rawi = 0, knLi = 0; i < 16; ++i) {
      const raw0 = kn[rawi++];
      const raw1 = kn[rawi++];
      this.keys[knLi] = (raw0 & 0x00fc0000) << 6;
      this.keys[knLi] |= (raw0 & 0x00000fc0) << 10;
      this.keys[knLi] |= (raw1 & 0x00fc0000) >>> 10;
      this.keys[knLi] |= (raw1 & 0x00000fc0) >>> 6;
      ++knLi;
      this.keys[knLi] = (raw0 & 0x0003f000) << 12;
      this.keys[knLi] |= (raw0 & 0x0000003f) << 16;
      this.keys[knLi] |= (raw1 & 0x0003f000) >>> 4;
      this.keys[knLi] |= (raw1 & 0x0000003f);
      ++knLi;
    }
  }

  enc8(text: Uint8Array): Uint8Array {
    const b = text.slice();
    let i = 0;
    let l = (b[i++] << 24) | (b[i++] << 16) | (b[i++] << 8) | b[i++];
    let r = (b[i++] << 24) | (b[i++] << 16) | (b[i++] << 8) | b[i++];

    let x = ((l >>> 4) ^ r) & 0x0f0f0f0f;
    r ^= x;
    l ^= x << 4;
    x = ((l >>> 16) ^ r) & 0x0000ffff;
    r ^= x;
    l ^= x << 16;
    x = ((r >>> 2) ^ l) & 0x33333333;
    l ^= x;
    r ^= x << 2;
    x = ((r >>> 8) ^ l) & 0x00ff00ff;
    l ^= x;
    r ^= x << 8;
    r = (r << 1) | ((r >>> 31) & 1);
    x = (l ^ r) & 0xaaaaaaaa;
    l ^= x;
    r ^= x;
    l = (l << 1) | ((l >>> 31) & 1);

    for (let round = 0, keysi = 0; round < 8; ++round) {
      x = (r << 28) | (r >>> 4);
      x ^= this.keys[keysi++];
      let fval = SP7[x & 0x3f];
      fval |= SP5[(x >>> 8) & 0x3f];
      fval |= SP3[(x >>> 16) & 0x3f];
      fval |= SP1[(x >>> 24) & 0x3f];
      x = r ^ this.keys[keysi++];
      fval |= SP8[x & 0x3f];
      fval |= SP6[(x >>> 8) & 0x3f];
      fval |= SP4[(x >>> 16) & 0x3f];
      fval |= SP2[(x >>> 24) & 0x3f];
      l ^= fval;
      x = (l << 28) | (l >>> 4);
      x ^= this.keys[keysi++];
      fval = SP7[x & 0x3f];
      fval |= SP5[(x >>> 8) & 0x3f];
      fval |= SP3[(x >>> 16) & 0x3f];
      fval |= SP1[(x >>> 24) & 0x3f];
      x = l ^ this.keys[keysi++];
      fval |= SP8[x & 0x0000003f];
      fval |= SP6[(x >>> 8) & 0x3f];
      fval |= SP4[(x >>> 16) & 0x3f];
      fval |= SP2[(x >>> 24) & 0x3f];
      r ^= fval;
    }

    r = (r << 31) | (r >>> 1);
    x = (l ^ r) & 0xaaaaaaaa;
    l ^= x;
    r ^= x;
    l = (l << 31) | (l >>> 1);
    x = ((l >>> 8) ^ r) & 0x00ff00ff;
    r ^= x;
    l ^= x << 8;
    x = ((l >>> 2) ^ r) & 0x33333333;
    r ^= x;
    l ^= x << 2;
    x = ((r >>> 16) ^ l) & 0x0000ffff;
    l ^= x;
    r ^= x << 16;
    x = ((r >>> 4) ^ l) & 0x0f0f0f0f;
    l ^= x;
    r ^= x << 4;

    const words = [r, l];
    for (i = 0; i < 8; i++) {
      b[i] = (words[i >>> 2] >>> (8 * (3 - (i % 4)))) % 256;
      if (b[i] < 0) {
        b[i] += 256;
      }
    }
    return b;
  }
}

export function encryptVncChallenge(password: string, challenge: Buffer): Buffer {
  if (challenge.length !== 16) {
    throw new Error("VNC challenge must be 16 bytes");
  }
  const key = Buffer.alloc(8);
  Buffer.from(password, "utf8").copy(key, 0, 0, 8);
  const des = new DES(key);
  const out = Buffer.alloc(16);
  out.set(des.enc8(challenge.subarray(0, 8)), 0);
  out.set(des.enc8(challenge.subarray(8, 16)), 8);
  return out;
}
