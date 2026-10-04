// @vitest-environment node
import { describe, expect, it } from "vitest";
import { originAllowed } from "../../backend/functions/media/handler";
import { ImportError, resolvePublicAddress, safeFetch } from "./safe-fetch";

const answers = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("resolvePublicAddress", () => {
  it("returns a public address", async () => {
    await expect(resolvePublicAddress("cdn.example.com", answers("93.184.216.34"))).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("refuses names that resolve to private addresses", async () => {
    await expect(resolvePublicAddress("evil.example.com", answers("169.254.169.254"))).rejects.toThrow(/private or local/);
    await expect(resolvePublicAddress("evil.example.com", answers("fd00::1"))).rejects.toThrow(/private or local/);
  });

  it("refuses when any of several answers is private (DNS rebinding)", async () => {
    await expect(resolvePublicAddress("mixed.example.com", answers("93.184.216.34", "10.0.0.5"))).rejects.toThrow(/private or local/);
  });

  it("explains names that do not exist", async () => {
    const failing = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(resolvePublicAddress("nope.example.com", failing)).rejects.toThrow(/could not be found/);
  });
});

describe("safeFetch", () => {
  it("never connects to a link that resolves privately", async () => {
    const error = await safeFetch("https://internal.example.com/video.mp4", { resolve: answers("127.0.0.1") }).catch((e) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.permanent).toBe(true);
  });
});

describe("originAllowed", () => {
  const allowed = ["http://localhost:3333", "https://post-social-*-app-build-26.vercel.app"];
  it("allows the web app and its previews only", () => {
    expect(originAllowed("http://localhost:3333", allowed)).toBe(true);
    expect(originAllowed("https://post-social-git-phase-2-media-app-build-26.vercel.app", allowed)).toBe(true);
    expect(originAllowed("https://post-social-x.evil.com-app-build-26.vercel.app", allowed)).toBe(false);
    expect(originAllowed("https://evil.example", allowed)).toBe(false);
    expect(originAllowed("http://localhost:3334", allowed)).toBe(false);
  });
});
