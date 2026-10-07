// TikTok takes photos only by fetching them from a link on a domain we verified with TikTok
// (postsocial.xyz), as JPEG or WebP, at most 1080p and 20 MB, and it never follows
// redirects. So before a photo post, each image gets a TikTok-ready JPEG next to it in
// storage (turned upright, fitted inside 1080×1920), and TikTok fetches it through the
// website's /tiktok-media route, which passes a short-lived signed storage link through.
import sharp from "sharp";
import type { R2 } from "../../../backend/lib/media/r2";
import type { PublishMedia } from "./types";

// Our website's /tiktok-media route returns at most this much (Vercel's response limit).
const MAX_BYTES = 4 * 1024 * 1024;
const LINK_SECONDS = 2 * 3600;

export const tiktokPhotoKey = (storageKey: string) => storageKey.replace(/\/[^/]*$/, "/tiktok.jpg");

export function tiktokPhotoLink(site: string, signedUrl: string) {
  return `${site.replace(/\/$/, "")}/tiktok-media/${Buffer.from(signedUrl).toString("base64url")}.jpg`;
}

export const toTikTokJpeg = (input: Uint8Array) => fitJpeg(input, MAX_BYTES);

// Upright JPEG inside 1080×1920 (portrait) or 1920×1080 (landscape), never enlarged,
// lowering the quality until it fits `maxBytes`.
export async function fitJpeg(input: Uint8Array, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const meta = await sharp(input, { limitInputPixels: 120_000_000 }).metadata();
  const sideways = (meta.orientation ?? 1) >= 5;
  const width = (sideways ? meta.height : meta.width) ?? 0;
  const height = (sideways ? meta.width : meta.height) ?? 0;
  const [boxW, boxH] = width > height ? [1920, 1080] : [1080, 1920];
  for (const quality of [88, 78, 65, 50]) {
    const out = await sharp(input, { limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width: boxW, height: boxH, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }) // transparent PNGs: white, not black
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= maxBytes) return new Uint8Array(out);
  }
  throw new Error("This photo is too detailed to fit the size limit; export it smaller and try again.");
}

// Makes (or reuses) each photo's TikTok copy and returns the links TikTok will fetch.
export function tiktokPhotoLinks(deps: { r2: R2; site: string; http?: typeof fetch; convert?: (input: Uint8Array) => Promise<Uint8Array<ArrayBuffer>> }) {
  const http = deps.http ?? fetch;
  const convert = deps.convert ?? toTikTokJpeg;
  return async (photos: PublishMedia[], onEach?: () => Promise<void>) => {
    const links: string[] = [];
    for (const photo of photos) {
      const key = tiktokPhotoKey(photo.storage_key);
      if (!(await deps.r2.head(key))) {
        const source = await http(photo.url);
        if (!source.ok) throw new Error(`The stored photo ${photo.name} could not be read (${source.status}).`);
        await deps.r2.put(key, await convert(new Uint8Array(await source.arrayBuffer())), "image/jpeg");
      }
      links.push(tiktokPhotoLink(deps.site, await deps.r2.presignGet(key, LINK_SECONDS)));
      await onEach?.();
    }
    return links;
  };
}
