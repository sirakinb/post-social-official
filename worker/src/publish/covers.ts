// Video covers: a JPEG copy of a library image (turned upright, inside 1080×1920, at most
// 2 MB, YouTube's thumbnail limit), or a still frame of the video at a given moment.
// Platforms that fetch by link (Instagram) get a short-lived signed link to the copy.
import { spawn } from "node:child_process";
import type { R2 } from "../../../backend/lib/media/r2";
import { fitJpeg } from "./tiktok-photos";
import type { PublishMedia } from "./types";

const MAX_BYTES = 2 * 1024 * 1024;
const LINK_SECONDS = 2 * 3600;

export const coverKey = (storageKey: string) => storageKey.replace(/\/[^/]*$/, "/cover.jpg");

export function coverImage(deps: { r2: R2; http?: typeof fetch }, cover: PublishMedia) {
  const http = deps.http ?? fetch;
  return async () => {
    const key = coverKey(cover.storage_key);
    let bytes: Uint8Array<ArrayBuffer>;
    const stored = await deps.r2.head(key);
    if (stored) {
      const r = await http(await deps.r2.presignGet(key, 600));
      bytes = new Uint8Array(await r.arrayBuffer());
    } else {
      const source = await http(cover.url);
      if (!source.ok) throw new Error(`The cover image ${cover.name} could not be read (${source.status}).`);
      bytes = await fitJpeg(new Uint8Array(await source.arrayBuffer()), MAX_BYTES);
      await deps.r2.put(key, bytes, "image/jpeg");
    }
    return { bytes, link: await deps.r2.presignGet(key, LINK_SECONDS) };
  };
}

// A full-size still of the video at `ms`, as JPEG (≤ 2 MB).
export function videoFrame(videoUrl: string, run = ffmpegStill) {
  return async (ms: number) => {
    for (const q of [2, 4, 7]) {
      const jpeg = await run(videoUrl, ms / 1000, q);
      if (jpeg.byteLength <= MAX_BYTES) return jpeg;
    }
    throw new Error("The cover frame is too detailed to fit the 2 MB thumbnail limit.");
  };
}

function ffmpegStill(url: string, atSeconds: number, quality: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    // Read only over https, and only as a real video container (never a playlist).
    const args = ["-hide_banner", "-loglevel", "error", "-protocol_whitelist", "https,tls,tcp", "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm",
      "-ss", String(atSeconds), "-i", url, "-frames:v", "1", "-vf", "scale='min(1080,iw)':-2", "-q:v", String(quality), "-f", "image2", "pipe:1"];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let error = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (error += c.toString()));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      if (code === 0 && out.length) resolve(new Uint8Array(out));
      else reject(new Error(error.trim().slice(0, 300) || `ffmpeg exited with ${code}`));
    });
  });
}
