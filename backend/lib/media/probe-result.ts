// Turns a mediainfo.js analysis into stored media details, or a plain-language reason the
// file cannot be used. Pure, so it is easy to test with recorded results.
import type { MediaType } from "./rules";

type Track = Record<string, unknown> & { "@type": string };
export type MediaInfoResult = { media?: { track?: Track[] } | null };

export type ProbeOutcome =
  | { ok: true; mimeType: string; mediaType: MediaType; width: number | null; height: number | null; durationSeconds: number | null }
  | { ok: false; reason: string };

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function int(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n);
}

export function interpretProbe(result: MediaInfoResult, expected: MediaType | null): ProbeOutcome {
  const tracks = result.media?.track ?? [];
  const general = tracks.find((t) => t["@type"] === "General");
  const video = tracks.find((t) => t["@type"] === "Video");
  const image = tracks.find((t) => t["@type"] === "Image");
  const format = String(general?.Format ?? "").toLowerCase();
  const profile = String(general?.Format_Profile ?? "").toLowerCase();

  let mimeType: string | null = null;
  let mediaType: MediaType | null = null;
  if (format === "mpeg-4") {
    mimeType = profile.includes("quicktime") ? "video/quicktime" : "video/mp4";
    mediaType = "video";
  } else if (format === "webm") {
    mimeType = "video/webm";
    mediaType = "video";
  } else if (format === "jpeg") {
    mimeType = "image/jpeg";
    mediaType = "image";
  } else if (format === "png") {
    mimeType = "image/png";
    mediaType = "image";
  } else if (format === "webp") {
    mimeType = "image/webp";
    mediaType = "image";
  }

  if (!mimeType || !mediaType) {
    return { ok: false, reason: "This file is not a supported video or image. Use MP4, MOV or WebM video, or JPEG, PNG or WebP images." };
  }
  if (expected && expected !== mediaType) {
    return { ok: false, reason: `This file was sent as ${expected === "video" ? "a video" : "an image"} but is actually ${mediaType === "video" ? "a video" : "an image"}.` };
  }

  if (mediaType === "video") {
    if (!video) return { ok: false, reason: "This file has no video in it." };
    const duration = num(video.Duration) ?? num(general?.Duration);
    if (!duration || duration <= 0) return { ok: false, reason: "This video has no length. It may be damaged; export it again." };
    return { ok: true, mimeType, mediaType, width: int(video.Width), height: int(video.Height), durationSeconds: Math.round(duration * 1000) / 1000 };
  }

  const picture = image ?? video; // some WebP files report a Video track
  return { ok: true, mimeType, mediaType, width: int(picture?.Width), height: int(picture?.Height), durationSeconds: null };
}

// Cheap first look at a file's opening bytes, before the full (memory-hungry) analysis:
// every supported format starts with a known signature. MP4 and MOV start with a box whose
// type sits at bytes 4-8.
const MP4_BOXES = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"]);

export function signatureProblem(head: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (head.length >= 8 && MP4_BOXES.has(ascii(4, 8))) return null;
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return null; // WebM (Matroska)
  if (starts(0xff, 0xd8, 0xff)) return null; // JPEG
  if (starts(0x89, 0x50, 0x4e, 0x47)) return null; // PNG
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return null;
  return "This file is not a supported video or image. Use MP4, MOV or WebM video, or JPEG, PNG or WebP images.";
}
