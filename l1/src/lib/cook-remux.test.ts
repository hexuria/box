import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ftypMajorBrand, isFragmentedMp4, remuxMp4Faststart } from "./cook-remux.ts";

function box(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(payload, 8);
  return out;
}

test("iso5 ftyp is treated as fragmented cook mp4", () => {
  const ftyp = box("ftyp", Buffer.from("iso5iso6mp41", "ascii"));
  assert.equal(ftypMajorBrand(ftyp), "iso5");
  assert.equal(isFragmentedMp4(ftyp), true);
});

test("isom/mp42 progressive mp4 is not remuxed again", () => {
  const ftyp = box("ftyp", Buffer.from("isomiso2avc1mp41", "ascii"));
  assert.equal(ftypMajorBrand(ftyp), "isom");
  assert.equal(isFragmentedMp4(ftyp), false);
});

test("short or non-mp4 buffers are left alone", () => {
  assert.equal(isFragmentedMp4(new Uint8Array([0, 1, 2])), false);
  assert.equal(ftypMajorBrand(Buffer.from("not an mp4")), null);
});

test("remuxMp4Faststart turns iso5 fMP4 into progressive isom", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cook-remux-live-"));
  const src = join(dir, "frag.mp4");
  try {
    const make = spawnSync(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=64x48:d=0.5:r=8",
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=64x48:d=0.5:r=8",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+frag_keyframe+empty_moov+default_base_moof",
        src,
      ],
      { encoding: "utf8" },
    );
    if (make.status !== 0) {
      return;
    }
    const bytes = await readFile(src);
    assert.equal(isFragmentedMp4(bytes), true);
    const out = await remuxMp4Faststart(bytes);
    assert.equal(isFragmentedMp4(out), false);
    assert.equal(ftypMajorBrand(out), "isom");
    assert.ok(out.byteLength > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
