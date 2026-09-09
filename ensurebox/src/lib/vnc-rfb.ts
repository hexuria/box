import { encryptVncChallenge } from "./vnc-des";

const RFB_VERSION = Buffer.from("RFB 003.008\n", "ascii");
const SECURITY_NONE = 1;
const SECURITY_VNC = 2;

export class BytePump {
  private buf = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  closed = false;
  closeError: Error | null = null;

  push(data: Buffer): void {
    if (this.closed) {
      return;
    }
    this.buf = Buffer.concat([this.buf, data]);
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }

  close(err?: Error): void {
    this.closed = true;
    this.closeError = err ?? null;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }

  async readExact(n: number): Promise<Buffer> {
    while (this.buf.length < n) {
      if (this.closed) {
        throw this.closeError ?? new Error("RFB stream closed");
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return Buffer.from(out);
  }

  rest(): Buffer {
    const out = this.buf;
    this.buf = Buffer.alloc(0);
    return out;
  }
}

async function readFailureReason(read: BytePump, fallback: string): Promise<string> {
  try {
    const len = (await read.readExact(4)).readUInt32BE(0);
    if (len > 0 && len < 4096) {
      const reason = (await read.readExact(len)).toString("utf8").trim();
      if (reason) {
        return reason;
      }
    }
  } catch {
    // keep fallback
  }
  return fallback;
}

/**
 * Speak RFB 3.8 to the guest until SecurityResult OK.
 * Leaves ClientInit unread so the browser can send it.
 */
export async function completeServerRfbAuth(
  read: BytePump,
  write: (data: Buffer) => void,
  password: string,
): Promise<void> {
  const version = await read.readExact(12);
  if (!version.toString("ascii").startsWith("RFB ")) {
    throw new Error("desktop upstream is not RFB");
  }
  write(RFB_VERSION);

  const ntypes = (await read.readExact(1))[0];
  if (ntypes === 0) {
    throw new Error(await readFailureReason(read, "RFB security handshake failed"));
  }
  const types = [...(await read.readExact(ntypes))];
  if (types.includes(SECURITY_VNC)) {
    write(Buffer.from([SECURITY_VNC]));
    const challenge = await read.readExact(16);
    write(encryptVncChallenge(password, challenge));
    const status = (await read.readExact(4)).readUInt32BE(0);
    if (status !== 0) {
      throw new Error(await readFailureReason(read, "desktop authentication failed"));
    }
    return;
  }
  if (types.includes(SECURITY_NONE)) {
    write(Buffer.from([SECURITY_NONE]));
    const status = (await read.readExact(4)).readUInt32BE(0);
    if (status !== 0) {
      throw new Error(await readFailureReason(read, "RFB security type None rejected"));
    }
    return;
  }
  throw new Error(`unsupported RFB security types: ${types.join(",")}`);
}

/** Present RFB 3.8 with security type None so the browser never needs a password. */
export async function offerUnauthedRfbToClient(
  read: BytePump,
  write: (data: Buffer) => void,
): Promise<void> {
  write(RFB_VERSION);
  const clientVersion = await read.readExact(12);
  if (!clientVersion.toString("ascii").startsWith("RFB ")) {
    throw new Error("client is not RFB");
  }
  write(Buffer.from([1, SECURITY_NONE]));
  const selected = (await read.readExact(1))[0];
  if (selected !== SECURITY_NONE) {
    throw new Error(`client selected unsupported security type ${selected}`);
  }
  write(Buffer.alloc(4));
}
