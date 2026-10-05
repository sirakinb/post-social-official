import { describe, expect, it } from "vitest";
import { fitsFor } from "./media-view";

describe("where a file fits", () => {
  it("names the platforms a file suits from its shape and length", () => {
    expect(fitsFor({ type: "video", width: 1080, height: 1920, duration: 42 })).toBe("Instagram and Facebook Reels, YouTube Shorts, TikTok, Threads");
    expect(fitsFor({ type: "video", width: 1920, height: 1080, duration: 600 })).toBe("TikTok, Facebook video");
    expect(fitsFor({ type: "image", width: 1080, height: 1350, duration: null })).toBe("Instagram feed, Facebook, Threads");
    expect(fitsFor({ type: "image", width: 1080, height: 1920, duration: null })).toBe("Facebook, Threads");
  });
});
