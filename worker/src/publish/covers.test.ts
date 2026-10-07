// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { R2 } from "../../../backend/lib/media/r2";
import { coverImage, coverKey, videoFrame } from "./covers";
import type { PublishMedia } from "./types";

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#c86" } }).png().toBuffer();

describe("coverImage", () => {
  it("stores an upright JPEG copy once, then reuses it", async () => {
    const stored = new Map<string, Uint8Array>();
    let fetchedOriginal = 0;
    const r2 = {
      head: async (key: string) => (stored.has(key) ? { sizeBytes: stored.get(key)!.length, contentType: "image/jpeg" } : null),
      put: async (key: string, body: Uint8Array) => void stored.set(key, body),
      presignGet: async (key: string) => `https://store.example/${key}?sig=1`,
    } as unknown as R2;
    const original = await png(3000, 5000);
    const http = (async (url: string) => {
      if (url.includes("cover.jpg")) return new Response(new Uint8Array(stored.get("workspaces/w/media/c/cover.jpg")!));
      fetchedOriginal++;
      return new Response(original);
    }) as unknown as typeof fetch;
    const cover = { storage_key: "workspaces/w/media/c/title.png", url: "https://store.example/original", name: "title.png" } as PublishMedia;

    const first = await coverImage({ r2, http }, cover)();
    const second = await coverImage({ r2, http }, cover)();
    expect(fetchedOriginal).toBe(1);
    expect(first.link).toBe("https://store.example/workspaces/w/media/c/cover.jpg?sig=1");
    expect(await sharp(first.bytes).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1800 });
    expect(second.bytes.byteLength).toBe(first.bytes.byteLength);
    expect(first.bytes.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(coverKey("a/b/c.mov")).toBe("a/b/cover.jpg");
  });
});

describe("videoFrame", () => {
  it("lowers JPEG quality until the still fits the 2 MB thumbnail limit", async () => {
    const tried: number[] = [];
    const frame = videoFrame("https://store.example/v.mp4", async (_url, at, q) => {
      tried.push(q);
      expect(at).toBe(4.2);
      return new Uint8Array(q < 7 ? 3 * 1024 * 1024 : 900_000);
    });
    expect((await frame(4200)).byteLength).toBe(900_000);
    expect(tried).toEqual([2, 4, 7]);
  });
});
