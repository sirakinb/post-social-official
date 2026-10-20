// iPhones save video as MOV. Facebook Reels, LinkedIn and Bluesky only take MP4, so after a
// MOV is checked it is rewrapped as MP4: the same video and sound, copied into the other
// container (no re-encoding, no quality loss, seconds of work). If that fails for any
// reason the MOV stays as it was; platforms that take MOV still work.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { R2 } from "../../backend/lib/media/r2";

const PART_BYTES = 16 * 1024 * 1024;
const REMUX_TIMEOUT_MS = 10 * 60_000;

// Runs ffmpeg from `url` (a signed storage link) to `outFile`. Injected in tests.
export type RunRemux = (url: string, outFile: string, videoFormat: string | undefined) => Promise<void>;

export const mp4Name = (fileName: string) => `${fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "video"}.mp4`;

// Rewraps the stored MOV at `key` as an MP4 next to it. Returns the new key and size, or
// null when the file couldn't be rewrapped.
export async function remuxToMp4(
  deps: { r2: R2; log: (message: string, details?: Record<string, unknown>) => void; run?: RunRemux },
  key: string,
  fileName: string,
  videoFormat: string | undefined,
): Promise<{ key: string; fileName: string; sizeBytes: number } | null> {
  const run = deps.run ?? ffmpegRemux;
  const dir = await mkdtemp(path.join(tmpdir(), "remux-"));
  const outFile = path.join(dir, "out.mp4");
  const name = mp4Name(fileName);
  const newKey = key.replace(/\/[^/]*$/, `/${name}`);
  let uploadId: string | null = null;
  try {
    await run(await deps.r2.presignGet(key, 30 * 60), outFile, videoFormat);
    const { size } = await stat(outFile);
    if (!size) throw new Error("ffmpeg wrote an empty file");
    uploadId = await deps.r2.createMultipartUpload(newKey, "video/mp4");
    const parts: Array<{ partNumber: number; etag: string }> = [];
    // One part in memory at a time, however large the video.
    for await (const chunk of createReadStream(outFile, { highWaterMark: PART_BYTES })) {
      const body = new Uint8Array(chunk as Buffer);
      parts.push({ partNumber: parts.length + 1, etag: await deps.r2.uploadPart(newKey, uploadId, parts.length + 1, body) });
    }
    await deps.r2.completeMultipartUpload(newKey, uploadId, parts);
    uploadId = null;
    return { key: newKey, fileName: name, sizeBytes: size };
  } catch (error) {
    if (uploadId) await deps.r2.abortMultipartUpload(newKey, uploadId).catch(() => undefined);
    deps.log("mov to mp4 failed, keeping the mov", { key, error: (error as Error).message?.slice(0, 300) });
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const ffmpegRemux: RunRemux = (url, outFile, videoFormat) =>
  new Promise((resolve, reject) => {
    // Read only over https, and only as a real video container (never a playlist). Keep the
    // first video and (if any) first sound track: iPhones add metadata tracks MP4 can't hold.
    // HEVC needs the hvc1 tag in MP4 or Apple devices and some platforms won't play it.
    const tag = /hevc/i.test(videoFormat ?? "") ? ["-tag:v", "hvc1"] : [];
    const args = ["-hide_banner", "-loglevel", "error", "-protocol_whitelist", "https,tls,tcp", "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2",
      "-i", url, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", ...tag, "-movflags", "+faststart", "-f", "mp4", "-y", outFile];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), REMUX_TIMEOUT_MS);
    child.stderr.on("data", (c: Buffer) => (error += c.toString()));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(error.trim().slice(0, 300) || `ffmpeg exited with ${code}`));
    });
  });
