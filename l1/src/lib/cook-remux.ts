import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FRAGMENTED_BRANDS = new Set(["iso5", "dash", "cmfc"]);

export function ftypMajorBrand(bytes: Uint8Array): string | null {
  if (bytes.length < 12) {
    return null;
  }
  const tag = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  if (tag !== "ftyp") {
    return null;
  }
  return String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
}

/** ffmpeg `+empty_moov` writes major brand iso5. Chrome often plays that as one frame. */
export function isFragmentedMp4(bytes: Uint8Array): boolean {
  const brand = ftypMajorBrand(bytes);
  return brand != null && FRAGMENTED_BRANDS.has(brand);
}

function runFfmpeg(args: string[], timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg remux timed out"));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg remux exited ${code}`));
    });
  });
}

/** Stream-copy remux to `+faststart`. Returns the original bytes if remux is unnecessary or fails. */
export async function remuxMp4Faststart(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isFragmentedMp4(bytes)) {
    return bytes;
  }
  const dir = await mkdtemp(join(tmpdir(), "cook-remux-"));
  const src = join(dir, "in.mp4");
  const dest = join(dir, "out.mp4");
  try {
    await writeFile(src, bytes);
    await runFfmpeg([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      src,
      "-an",
      "-c:v",
      "copy",
      "-movflags",
      "+faststart",
      dest,
    ]);
    const out = await readFile(dest);
    if (out.byteLength === 0 || isFragmentedMp4(out)) {
      return bytes;
    }
    return out;
  } catch {
    return bytes;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
