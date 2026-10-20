// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { R2 } from "../../../backend/lib/media/r2";
import { instagramCanvas, instagramPhotoLink, toInstagramJpeg } from "./instagram-photos";
import type { PublishMedia } from "./types";

const image = (width: number, height: number, format: "jpeg" | "png" | "webp", orientation?: number) => {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } });
  return (format === "png" ? img.png() : format === "webp" ? img.webp() : img.jpeg().withMetadata(orientation ? { orientation } : {})).toBuffer();
};
const shape = async (input: Buffer) => {
  const meta = await sharp(await toInstagramJpeg(input)).metadata();
  return [meta.format, meta.width, meta.height];
};

describe("instagramCanvas", () => {
  it("widens tall photos to 4:5 and deepens wide ones to 1.91:1, at most 1440 wide", () => {
    expect(instagramCanvas(3024, 4032)).toEqual({ width: 1440, height: 1800 }); // iPhone 3:4 → 4:5
    expect(instagramCanvas(1080, 1920)).toEqual({ width: 1440, height: 1800 }); // 9:16 → 4:5
    expect(instagramCanvas(4000, 1000)).toEqual({ width: 1440, height: 754 }); // panorama → 1.91:1
    expect(instagramCanvas(1000, 1000)).toEqual({ width: 1000, height: 1000 }); // fits, small: untouched
  });
});

describe("toInstagramJpeg", () => {
  it("fits a phone photo to 4:5 as JPEG", async () => {
    expect(await shape(await image(3024, 4032, "jpeg"))).toEqual(["jpeg", 1440, 1800]);
  });

  it("turns a sideways photo upright before fitting it", async () => {
    // Stored 4032×3024 with "rotate 90°": really a 3:4 portrait.
    expect(await shape(await image(4032, 3024, "jpeg", 6))).toEqual(["jpeg", 1440, 1800]);
  });

  it("converts PNG and WebP, and keeps photos that already fit their shape", async () => {
    expect(await shape(await image(1080, 1350, "png"))).toEqual(["jpeg", 1080, 1350]);
    expect(await shape(await image(1200, 628, "webp"))).toEqual(["jpeg", 1200, 628]);
  });
});

describe("instagramPhotoLink", () => {
  it("makes the Instagram copy once, then reuses it", async () => {
    const stored = new Map<string, Uint8Array>();
    const r2 = {
      head: async (key: string) => (stored.has(key) ? { sizeBytes: 1, contentType: "image/jpeg" } : null),
      put: async (key: string, body: Uint8Array) => void stored.set(key, body),
      presignGet: async (key: string) => `https://r2.example/${key}?sig`,
    } as unknown as R2;
    let fetched = 0;
    const link = instagramPhotoLink({ r2, http: (async () => (fetched++, new Response("raw"))) as unknown as typeof fetch, convert: async () => new Uint8Array([1]) });
    const photo = { id: "m1", name: "p.png", status: "ready", media_type: "image", mime_type: "image/png", size_bytes: 1, width: 3, height: 4, duration_seconds: null, storage_key: "workspaces/w/media/m1/p.png", url: "https://store/p" } as PublishMedia;
    expect(await link(photo)).toBe("https://r2.example/workspaces/w/media/m1/instagram.jpg?sig");
    await link(photo);
    expect(fetched).toBe(1);
  });
});
