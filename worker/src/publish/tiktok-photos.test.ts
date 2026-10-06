// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { R2 } from "../../../backend/lib/media/r2";
import { tiktokMediaSource } from "../../../src/lib/tiktok-media";
import { tiktokPhotoLink, tiktokPhotoLinks, toTikTokJpeg } from "./tiktok-photos";
import type { PublishMedia } from "./types";

const image = (width: number, height: number, format: "jpeg" | "png", orientation?: number) => {
  const img = sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 0.5 } } });
  return (format === "png" ? img.png() : img.jpeg().withMetadata(orientation ? { orientation } : {})).toBuffer();
};

describe("toTikTokJpeg", () => {
  it("turns a sideways phone photo upright and fits it inside 1080×1920", async () => {
    // Stored 4000×3000 with EXIF "rotate 90°": the photo is really 3000×4000 portrait.
    const out = await toTikTokJpeg(await image(4000, 3000, "jpeg", 6));
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.width, meta.height, meta.orientation ?? 1]).toEqual(["jpeg", 1080, 1440, 1]);
  });

  it("fits landscape photos inside 1920×1080 and never enlarges small ones", async () => {
    expect(await sharp(await toTikTokJpeg(await image(4000, 2000, "png"))).metadata()).toMatchObject({ format: "jpeg", width: 1920, height: 960 });
    expect(await sharp(await toTikTokJpeg(await image(600, 400, "png"))).metadata()).toMatchObject({ width: 600, height: 400 });
  });
});

describe("tiktokPhotoLinks", () => {
  const photo = (i: number): PublishMedia => ({
    id: `m${i}`, name: `p${i}.png`, status: "ready", media_type: "image", mime_type: "image/png", size_bytes: 10, width: 10, height: 10, duration_seconds: null,
    storage_key: `workspaces/w/media/m${i}/p${i}.png`, url: `https://store.example/p${i}`,
  });

  it("makes each TikTok copy once, then reuses it", async () => {
    const stored = new Map<string, Uint8Array>();
    const r2 = {
      head: async (key: string) => (stored.has(key) ? { sizeBytes: stored.get(key)!.length, contentType: "image/jpeg" } : null),
      put: async (key: string, body: Uint8Array) => void stored.set(key, body),
      presignGet: async (key: string) => `https://acct.r2.example/bucket/${key}?X-Amz-Signature=s`,
    } as unknown as R2;
    let fetched = 0;
    const links = tiktokPhotoLinks({ r2, site: "https://www.postsocial.xyz/", http: (async () => (fetched++, new Response("raw"))) as unknown as typeof fetch, convert: async () => new Uint8Array([1, 2, 3]) });

    const first = await links([photo(0), photo(1)]);
    await links([photo(0), photo(1)]);
    expect(fetched).toBe(2);
    expect([...stored.keys()]).toEqual(["workspaces/w/media/m0/tiktok.jpg", "workspaces/w/media/m1/tiktok.jpg"]);
    expect(first[0]).toBe(tiktokPhotoLink("https://www.postsocial.xyz", "https://acct.r2.example/bucket/workspaces/w/media/m0/tiktok.jpg?X-Amz-Signature=s"));
    expect(first[0].startsWith("https://www.postsocial.xyz/tiktok-media/")).toBe(true);
  });
});

describe("tiktokMediaSource (the website route's check)", () => {
  const ws = "11111111-2222-4333-8444-555555555555";
  const media = "66666666-7777-4888-9999-000000000000";
  const signed = (path: string, host = `${"a".repeat(32)}.r2.cloudflarestorage.com`, query = "X-Amz-Expires=7200&X-Amz-Signature=abc") => `https://${host}${path}?${query}`;
  const file = (url: string) => tiktokPhotoLink("https://x", url).split("/tiktok-media/")[1];

  it("accepts a signed link to a TikTok copy in our storage", () => {
    const url = signed(`/postsocial-media-prod/workspaces/${ws}/media/${media}/tiktok.jpg`);
    expect(tiktokMediaSource(file(url))).toBe(url);
  });

  it("refuses anything else", () => {
    const copy = `/postsocial-media-prod/workspaces/${ws}/media/${media}/tiktok.jpg`;
    for (const url of [
      signed(`/postsocial-media-prod/workspaces/${ws}/media/${media}/original.png`), // the original, not the copy
      signed(`/other-bucket/workspaces/${ws}/media/${media}/tiktok.jpg`),
      signed(copy, "evil.example"),
      signed(copy, `${"a".repeat(32)}.r2.cloudflarestorage.com.evil.example`),
      signed(copy, undefined, "X-Amz-Expires=7200"), // unsigned
      `http://${"a".repeat(32)}.r2.cloudflarestorage.com${copy}?X-Amz-Expires=1&X-Amz-Signature=a`,
    ]) expect(tiktokMediaSource(file(url))).toBeNull();
    expect(tiktokMediaSource("not-base64!.jpg")).toBeNull();
    expect(tiktokMediaSource(`${file(signed(copy)).replace(".jpg", "")}.png`)).toBeNull();
  });
});
