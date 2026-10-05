// A still frame for each ready video, so the web app can show videos as pictures. ffmpeg
// reads about a second in (the very start is often black), scales it down and saves a
// JPEG next to the video in storage.
import { spawn } from "node:child_process";
import type { Sql } from "../../backend/lib/access";
import type { R2 } from "../../backend/lib/media/r2";

export type ExtractFrame = (url: string, atSeconds: number) => Promise<Uint8Array<ArrayBuffer>>;

export const posterKey = (storageKey: string) => storageKey.replace(/\/[^/]*$/, "/poster.jpg");

export const ffmpegFrame: ExtractFrame = (url, atSeconds) =>
  new Promise((resolve, reject) => {
    // The file came from a person or an AI: read it only over https, and only as a real
    // video container (never a playlist that could point ffmpeg at other files).
    const args = ["-hide_banner", "-loglevel", "error", "-protocol_whitelist", "https,tls,tcp", "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm", "-ss", String(atSeconds), "-i", url, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "4", "-f", "image2", "pipe:1"];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let error = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (error += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      if (code === 0 && out.length) resolve(new Uint8Array(out));
      else reject(new Error(error.trim().slice(0, 300) || `ffmpeg exited with ${code}`));
    });
  });

type Video = { id: string; storage_key: string; duration_seconds: string | null };

// Makes posters for up to `max` videos that don't have one yet (each video is tried once a
// day at most, so a broken file never loops). Returns how many were made.
export async function makePosters(sql: Sql, r2: R2, extract: ExtractFrame = ffmpegFrame, max = 5) {
  const due = await sql<Video>(
    `UPDATE public.media_assets SET poster_attempted_at = now()
     WHERE id IN (
       SELECT id FROM public.media_assets
       WHERE media_type = 'video' AND status = 'ready' AND poster_key IS NULL
         AND (poster_attempted_at IS NULL OR poster_attempted_at < now() - interval '1 day')
       ORDER BY created_at DESC LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, storage_key, duration_seconds`,
    [max],
  );
  let made = 0;
  for (const video of due) {
    try {
      const url = await r2.presignGet(video.storage_key, 600);
      const at = Number(video.duration_seconds) > 2 ? 1 : 0;
      const jpeg = await extract(url, at);
      const key = posterKey(video.storage_key);
      await r2.put(key, jpeg, "image/jpeg");
      await sql(`UPDATE public.media_assets SET poster_key = $2 WHERE id = $1 AND status = 'ready'`, [video.id, key]);
      made++;
    } catch {
      // Tried again tomorrow; the video itself is fine to post.
    }
  }
  return made;
}
