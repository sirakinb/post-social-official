import { describe, expect, it } from "vitest";
import { captionLimits, defaultMediaType, defaultTitle, destinationOptions, NEW_TIKTOK, tiktokLabel, tiktokProblems, type ComposerAccount, type ComposerMedia } from "./composer-model";

const video: ComposerMedia = { id: "v", name: "clip.mp4", type: "video", width: 1080, height: 1920, duration: 42, url: null };
const image: ComposerMedia = { id: "i", name: "a.jpg", type: "image", width: 1080, height: 1350, duration: null, url: null };
const account = (platform: ComposerAccount["platform"], captionMax: number | null = null): ComposerAccount => ({ id: platform, platform, name: platform, handle: platform, avatarUrl: null, captionMax, videoMaxSeconds: null });

describe("composer defaults", () => {
  it("picks the post type that fits the media", () => {
    expect(defaultMediaType("instagram", [video])).toBe("reel");
    expect(defaultMediaType("instagram", [image, image])).toBe("carousel");
    expect(defaultMediaType("facebook", [])).toBe("text");
    expect(defaultMediaType("threads", [image])).toBe("image");
  });

  it("titles YouTube Shorts from the caption's first line", () => {
    expect(defaultTitle("\nDay 2 of 7: the prompt\nmore")).toBe("Day 2 of 7: the prompt");
    expect(defaultTitle("x".repeat(150))).toHaveLength(100);
  });

  it("sends per-platform caption overrides in each platform's own field", () => {
    expect(destinationOptions(account("instagram"), { caption: "IG only" }, "Shared", [image])).toEqual({ media_type: "image", caption: "IG only" });
    expect(destinationOptions(account("threads"), { caption: "Short" }, "Shared", [])).toEqual({ media_type: "text", text: "Short" });
    expect(destinationOptions(account("youtube"), {}, "Hello\nworld", [video])).toEqual({ title: "Hello", privacy_status: "public" });
    expect(destinationOptions(account("facebook"), { mediaType: "link" }, "Read https://x.example/a now", [])).toEqual({ media_type: "link", link: "https://x.example/a" });
  });

  it("counts characters per platform", () => {
    const limits = captionLimits([account("threads", 500), account("instagram", 2200)], {}, "x".repeat(534));
    expect(limits.map((l) => [l.label, l.over])).toEqual([["Threads", true], ["IG", false]]);
  });
});

describe("TikTok guideline rules", () => {
  const info = { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], can_post: true, max_video_post_duration_sec: 60 };

  it("sends inbox posts without any posting choices", () => {
    expect(destinationOptions(account("tiktok"), { tiktok: NEW_TIKTOK }, "Hi", [video])).toEqual({ delivery_mode: "inbox", media_type: "video", ai_generated: false });
    expect(tiktokProblems(NEW_TIKTOK, null, [video])).toEqual([]);
  });

  it("requires a privacy choice with no default, and blocks incomplete disclosure", () => {
    const direct = { ...NEW_TIKTOK, mode: "direct" as const };
    expect(tiktokProblems(direct, info, [video])).toEqual([]);
    expect(tiktokProblems({ ...direct, privacyLevel: "PUBLIC_TO_EVERYONE", disclose: true }, info, [video])).toEqual(["You turned on content disclosure: choose Your brand, Branded content, or both."]);
    expect(tiktokProblems({ ...direct, privacyLevel: "SELF_ONLY", disclose: true, brandedContent: true }, info, [video])).toEqual(["Branded content can't be private on TikTok. Choose a wider audience."]);
    expect(tiktokProblems({ ...direct, privacyLevel: "PUBLIC_TO_EVERYONE" }, info, [{ ...video, duration: 75 }])[0]).toMatch(/up to 60 seconds/);
  });

  it("turns images into a photo post with an optional title and no Duet or Stitch", () => {
    const photo: ComposerMedia = { ...video, id: "p1", type: "image", duration: null };
    const direct = { ...NEW_TIKTOK, mode: "direct" as const, privacyLevel: "SELF_ONLY", comments: true, duet: true, stitch: true, title: " Three looks " };
    expect(destinationOptions(account("tiktok"), { tiktok: direct }, "Hi", [photo, { ...photo, id: "p2" }])).toMatchObject({
      delivery_mode: "direct", media_type: "photo", title: "Three looks", comments_enabled: true, duet_enabled: false, stitch_enabled: false,
    });
    expect(destinationOptions(account("tiktok"), { tiktok: { ...NEW_TIKTOK, title: "Kept for photos only" } }, "Hi", [video])).toEqual({ delivery_mode: "inbox", media_type: "video", ai_generated: false });
    expect(tiktokProblems(direct, info, Array.from({ length: 36 }, (_, i) => ({ ...photo, id: `p${i}` })))).toEqual(["TikTok photo posts can have at most 35 images; this one has 36."]);
    expect(tiktokLabel({ ...direct, disclose: true, yourBrand: true }, true)).toBe("Your photo will be labeled “Promotional content”.");
  });

  it("tells the person how TikTok will label the post", () => {
    const d = { ...NEW_TIKTOK, mode: "direct" as const, disclose: true };
    expect(tiktokLabel({ ...d, yourBrand: true })).toBe("Your video will be labeled “Promotional content”.");
    expect(tiktokLabel({ ...d, yourBrand: true, brandedContent: true })).toBe("Your video will be labeled “Paid partnership”.");
    expect(tiktokLabel(NEW_TIKTOK)).toBeNull();
  });
});
