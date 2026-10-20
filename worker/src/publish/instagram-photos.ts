// Instagram takes feed photos only as JPEG, between 4:5 (portrait) and 1.91:1 (landscape).
// Phone photos are 3:4 and often PNG or WebP after editing, so any photo outside those
// rules gets an Instagram copy next to it in storage: turned upright, the whole photo kept,
// with a blurred, stretched copy of itself filling the space up to the nearest allowed
// shape, at most 1440 wide and 8 MB. Every photo goes through this: a JPEG's recorded size
// can't show whether it is stored sideways with a "turn me" flag, and Instagram resizes to
// 1080 wide anyway.
import sharp from "sharp";
import type { R2 } from "../../../backend/lib/media/r2";
import type { PublishMedia } from "./types";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_WIDTH = 1440;
const LINK_SECONDS = 2 * 3600;
const PORTRAIT = 4 / 5;
const LANDSCAPE = 1.91;

export const instagramPhotoKey = (storageKey: string) => storageKey.replace(/\/[^/]*$/, "/instagram.jpg");

// The canvas a photo of this upright size is placed on.
export function instagramCanvas(width: number, height: number) {
  const ratio = width / height;
  let [w, h] = [width, height];
  if (ratio < PORTRAIT) w = Math.round(height * PORTRAIT);
  else if (ratio > LANDSCAPE) h = Math.round(width / LANDSCAPE);
  const scale = Math.min(1, MAX_WIDTH / w);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export async function toInstagramJpeg(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const upright = await sharp(input, { limitInputPixels: 120_000_000 }).rotate().flatten({ background: "#ffffff" }).toBuffer({ resolveWithObject: true });
  const { width, height } = upright.info;
  const canvas = instagramCanvas(width, height);
  const photo = await sharp(upright.data).resize({ width: canvas.width, height: canvas.height, fit: "inside" }).toBuffer();
  // Blurred at an eighth of the size, then stretched back: cheap, and soft enough to read as
  // a backdrop. Hidden entirely when the photo already fills the canvas.
  const background = await sharp(upright.data)
    .resize({ width: Math.max(1, Math.round(canvas.width / 8)), height: Math.max(1, Math.round(canvas.height / 8)), fit: "cover" })
    .blur(6)
    .resize({ width: canvas.width, height: canvas.height, fit: "fill" })
    .toBuffer();
  for (const quality of [88, 78, 65, 50]) {
    const out = await sharp(background).composite([{ input: photo, gravity: "center" }]).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= MAX_BYTES) return new Uint8Array(out);
  }
  throw new Error("This photo is too detailed to fit Instagram's 8 MB limit; export it smaller and try again.");
}

// The link Instagram fetches a photo from: its Instagram copy, made once, then reused.
export function instagramPhotoLink(deps: { r2: R2; http?: typeof fetch; convert?: (input: Uint8Array) => Promise<Uint8Array<ArrayBuffer>> }) {
  const http = deps.http ?? fetch;
  const convert = deps.convert ?? toInstagramJpeg;
  return async (photo: PublishMedia) => {
    const key = instagramPhotoKey(photo.storage_key);
    if (!(await deps.r2.head(key))) {
      const source = await http(photo.url);
      if (!source.ok) throw new Error(`The stored photo ${photo.name} could not be read (${source.status}).`);
      await deps.r2.put(key, await convert(new Uint8Array(await source.arrayBuffer())), "image/jpeg");
    }
    return deps.r2.presignGet(key, LINK_SECONDS);
  };
}
