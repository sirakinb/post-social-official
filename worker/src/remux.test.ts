// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { R2 } from "../../backend/lib/media/r2";
import { mp4Name, remuxToMp4, type RunRemux } from "./remux";

// Storage that keeps multipart uploads in memory.
function fakeR2() {
  const parts: Uint8Array[] = [];
  const done: Record<string, Uint8Array> = {};
  const aborted: string[] = [];
  const r2 = {
    presignGet: async (key: string) => `https://storage/${key}`,
    createMultipartUpload: async () => "up1",
    uploadPart: async (_key: string, _id: string, n: number, body: Uint8Array) => {
      parts[n - 1] = body;
      return `etag${n}`;
    },
    completeMultipartUpload: async (key: string) => {
      done[key] = Buffer.concat(parts);
    },
    abortMultipartUpload: async (key: string) => void aborted.push(key),
  } as unknown as R2;
  return { r2, done, aborted };
}

describe("remuxToMp4", () => {
  it("names the copy after the original", () => {
    expect(mp4Name("IMG_0001.MOV")).toBe("IMG_0001.mp4");
    expect(mp4Name("clip")).toBe("clip.mp4");
    expect(mp4Name(".mov")).toBe("video.mp4");
  });

  it("stores ffmpeg's output next to the MOV", async () => {
    const { r2, done } = fakeR2();
    let seen: unknown[] = [];
    const run: RunRemux = async (url, out, format) => {
      seen = [url, format];
      writeFileSync(out, "mp4 bytes");
    };
    const result = await remuxToMp4({ r2, log: () => undefined, run }, "ws/media/a1/IMG_0001.MOV", "IMG_0001.MOV", "HEVC");
    expect(result).toEqual({ key: "ws/media/a1/IMG_0001.mp4", fileName: "IMG_0001.mp4", sizeBytes: 9 });
    expect(seen).toEqual(["https://storage/ws/media/a1/IMG_0001.MOV", "HEVC"]);
    expect(Buffer.from(done["ws/media/a1/IMG_0001.mp4"]).toString()).toBe("mp4 bytes");
  });

  it("gives up quietly when ffmpeg fails", async () => {
    const { r2, done } = fakeR2();
    const logs: string[] = [];
    const run: RunRemux = async () => {
      throw new Error("codec not supported in container");
    };
    expect(await remuxToMp4({ r2, log: (m) => logs.push(m), run }, "k/a.mov", "a.mov", "AVC")).toBeNull();
    expect(done).toEqual({});
    expect(logs).toEqual(["mov to mp4 failed, keeping the mov"]);
  });

  it("cancels a half-stored copy", async () => {
    const { r2, aborted } = fakeR2();
    r2.uploadPart = async () => {
      throw new Error("network");
    };
    const run: RunRemux = async (_url, out) => writeFileSync(out, "x");
    expect(await remuxToMp4({ r2, log: () => undefined, run }, "k/a.mov", "a.mov", undefined)).toBeNull();
    expect(aborted).toEqual(["k/a.mp4"]);
  });

  // The real ffmpeg (installed in the worker image) on a rotated HEVC MOV like an iPhone's.
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
  it.skipIf(!hasFfmpeg)("keeps the video, sound and rotation when rewrapping a phone MOV", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "remux-test-"));
    const base = path.join(dir, "base.mov");
    const phone = path.join(dir, "phone.mov");
    const gen = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-f", "lavfi", "-i", "sine=f=440", "-t", "1", "-c:v", "libx264", "-c:a", "aac", base]);
    if (gen.status !== 0) return;
    expect(spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-display_rotation", "90", "-i", base, "-c", "copy", phone]).status).toBe(0);
    const { r2, done } = fakeR2();
    // Same arguments as production, reading a local file instead of an https link.
    const run: RunRemux = async (_url, out) => {
      const r = spawnSync("ffmpeg", ["-loglevel", "error", "-i", phone, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", "-f", "mp4", "-y", out]);
      if (r.status !== 0) throw new Error(String(r.stderr));
    };
    const result = await remuxToMp4({ r2, log: () => undefined, run }, "k/phone.mov", "phone.mov", "AVC");
    const out = path.join(dir, "out.mp4");
    writeFileSync(out, done[result!.key]);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:stream_side_data=rotation:format=format_name", "-of", "compact", out]).stdout.toString();
    expect(probe).toContain("codec_type=video");
    expect(probe).toContain("codec_type=audio");
    expect(probe).toMatch(/rotation=(-90|90|270)/);
    expect(existsSync(out) && readFileSync(out).length).toBeGreaterThan(0);
  });
});
