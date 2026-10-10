import { describe, expect, it } from "vitest";
import { destinationProblems, normalizeOptions, type DestinationOptions, type MediaFacts } from "./validate";

const media = (overrides: Partial<MediaFacts> = {}): MediaFacts => ({
  id: "m1", name: "clip.mp4", status: "ready", media_type: "video", mime_type: "video/mp4",
  size_bytes: 1_000_000, width: 1080, height: 1920, duration_seconds: 30, ...overrides,
});
const image = (overrides: Partial<MediaFacts> = {}) => media({ name: "photo.jpg", media_type: "image", mime_type: "image/jpeg", duration_seconds: null, width: 1080, height: 1350, ...overrides });
const check = (options: DestinationOptions, files: MediaFacts[], caption = "Hello", capabilities?: { video_max_seconds?: number }) =>
  destinationProblems({ options, caption, media: files, capabilities });

describe("normalizeOptions", () => {
  it("requires a post type and defaults TikTok interactions off", () => {
    expect(normalizeOptions("instagram", {}).problems).toEqual(["Choose an Instagram post type: image, reel or carousel."]);
    expect(normalizeOptions("youtube", { title: "x" }).problems[0]).toMatch(/public, unlisted or private/);
    const tiktok = normalizeOptions("tiktok", { privacy_level: "SELF_ONLY", unknown: 1 }).options;
    expect(tiktok).toEqual({
      kind: "tiktok", delivery_mode: "direct", privacy_level: "SELF_ONLY", comments_enabled: false, duet_enabled: false,
      stitch_enabled: false, disclose_your_brand: false, disclose_branded_content: false, ai_generated: false,
    });
  });
});

describe("Instagram", () => {
  it("accepts a JPEG image, a Reel and a carousel", () => {
    expect(check({ kind: "instagram", media_type: "image" }, [image()])).toEqual([]);
    expect(check({ kind: "instagram", media_type: "reel" }, [media()])).toEqual([]);
    expect(check({ kind: "instagram", media_type: "carousel" }, [image(), media({ id: "m2" })])).toEqual([]);
  });

  it("requires feed photos between 4:5 and 1.91:1", () => {
    expect(check({ kind: "instagram", media_type: "image" }, [image({ width: 1024, height: 1536 })])).toEqual([
      "Instagram photos must be between 4:5 (portrait) and 1.91:1 (landscape); photo.jpg is 1024×1536. Crop it to 4:5, e.g. 1080×1350.",
    ]);
    expect(check({ kind: "instagram", media_type: "image" }, [image({ width: 1080, height: 1080 })])).toEqual([]);
    expect(check({ kind: "instagram", media_type: "image" }, [image({ width: 1910, height: 1000 })])).toEqual([]);
  });

  it("explains each problem", () => {
    expect(check({ kind: "instagram", media_type: "image" }, [image({ mime_type: "image/png" })])).toEqual(["Instagram images must be JPEG; photo.jpg is image/png."]);
    expect(check({ kind: "instagram", media_type: "reel" }, [media({ duration_seconds: 1000 })])).toEqual(["Instagram Reels can be at most 15 minutes; clip.mp4 is 16 min 40 s."]);
    expect(check({ kind: "instagram", media_type: "carousel" }, [image()])).toEqual(["An Instagram carousel needs 2 to 10 files; this post has 1 file."]);
    expect(check({ kind: "instagram", media_type: "image" }, [image()], "x".repeat(2201))[0]).toMatch(/2,200 characters; this one is 2,201/);
  });
});

describe("Facebook", () => {
  it("checks Reels for length, format and 9:16", () => {
    expect(check({ kind: "facebook", media_type: "reel" }, [media()])).toEqual([]);
    expect(check({ kind: "facebook", media_type: "reel" }, [media({ duration_seconds: 120 })])).toEqual(["Facebook Reels can be at most 1 min 30 s; clip.mp4 is 2 minutes."]);
    expect(check({ kind: "facebook", media_type: "reel" }, [media({ width: 1920, height: 1080 })])).toEqual(["Facebook Reels must be vertical 9:16; clip.mp4 is 1920×1080."]);
    expect(check({ kind: "facebook", media_type: "reel" }, [media({ mime_type: "video/quicktime" })])).toEqual(["Facebook Reels must be MP4; clip.mp4 is video/quicktime."]);
  });

  it("requires text, a link, or the right media", () => {
    expect(check({ kind: "facebook", media_type: "text" }, [], "  ")).toEqual(["Write the text for this Facebook post."]);
    expect(check({ kind: "facebook", media_type: "link", link: "nope" }, [])).toEqual(["Add the link to share in this Facebook post (starting with https://)."]);
    expect(check({ kind: "facebook", media_type: "link", link: "https://postsocial.xyz" }, [])).toEqual([]);
    expect(check({ kind: "facebook", media_type: "video" }, [media({ width: 1920, height: 1080, duration_seconds: 600 })])).toEqual([]);
  });
});

describe("Threads", () => {
  it("limits text to 500 characters and carousels to 20 files", () => {
    expect(check({ kind: "threads", media_type: "text" }, [], "x".repeat(501))).toEqual(["Threads posts can be at most 500 characters; this one is 501."]);
    const many = Array.from({ length: 21 }, (_, i) => image({ id: `i${i}` }));
    expect(check({ kind: "threads", media_type: "carousel" }, many)).toEqual(["A Threads carousel needs 2 to 20 files; this post has 21 files."]);
    expect(check({ kind: "threads", media_type: "video" }, [media({ duration_seconds: 301 })])).toEqual(["Threads videos can be at most 5 minutes; clip.mp4 is 5 min 1 s."]);
  });
});

describe("YouTube", () => {
  it("needs a title and a vertical video of 3 minutes or less", () => {
    expect(check({ kind: "youtube", title: "Launch", privacy_status: "private" }, [media()])).toEqual([]);
    expect(check({ kind: "youtube", title: " ", privacy_status: "private" }, [media({ width: 1920, height: 1080, duration_seconds: 200 })])).toEqual([
      "Add a title for the YouTube Short.",
      "YouTube Shorts can be at most 3 minutes; clip.mp4 is 3 min 20 s.",
      "YouTube Shorts must be vertical or square; clip.mp4 is 1920×1080.",
    ]);
  });
});

describe("TikTok", () => {
  const direct = { kind: "tiktok", delivery_mode: "direct", privacy_level: "SELF_ONLY" } as const;
  it("requires an explicit audience and respects the creator's maximum length", () => {
    expect(check(direct, [media()])).toEqual([]);
    expect(check({ ...direct, privacy_level: undefined }, [media()])).toEqual(["Choose who can see this TikTok: everyone, friends, followers or only you."]);
    expect(check(direct, [media({ duration_seconds: 120 })], "Hi", { video_max_seconds: 60 })).toEqual(["Videos on this TikTok account can be at most 1 minute; clip.mp4 is 2 minutes."]);
  });

  it("does not need an audience for drafts", () => {
    expect(check({ kind: "tiktok", delivery_mode: "inbox" }, [media()])).toEqual([]);
  });

  it("makes images a photo post of 1 to 35 JPEG, PNG or WebP images", () => {
    expect(check(direct, [image(), image({ mime_type: "image/png" }), image({ mime_type: "image/webp" })])).toEqual([]);
    expect(check({ kind: "tiktok", delivery_mode: "inbox", media_type: "photo", title: "Three looks" }, [image()])).toEqual([]);
    expect(check(direct, Array.from({ length: 36 }, () => image()))).toEqual(["TikTok photo posts can have at most 35 images; this one has 36."]);
    expect(check({ ...direct, media_type: "photo" }, [image(), media()])).toEqual(["TikTok photo posts can only contain images; post videos separately."]);
    expect(check({ ...direct, media_type: "photo" }, [])).toEqual(["A TikTok post with photos needs at least 1 image."]);
    expect(check(direct, [image({ mime_type: "image/gif" })])).toEqual(["TikTok photos must be JPEG or PNG or WEBP; photo.jpg is image/gif."]);
    expect(check({ ...direct, title: "x".repeat(91) }, [image()])).toEqual(["TikTok photo titles can be at most 90 characters; this one is 91."]);
    expect(check({ ...direct, duet_enabled: true }, [image()])).toEqual(["Duet and Stitch aren't available for TikTok photo posts; turn them off."]);
    expect(check(direct, [image()], "x".repeat(4001))).toEqual(["TikTok photo captions can be at most 4,000 characters; this one is 4,001."]);
  });

  it("keeps a video post a video post", () => {
    expect(check({ ...direct, media_type: "video" }, [image()])).toEqual(["A TikTok post needs exactly 1 video; this post has 1 file."]);
    expect(check({ ...direct, title: "Hi" }, [media()])).toEqual(["TikTok videos don't have a separate title; put it in the caption."]);
    expect(normalizeOptions("tiktok", { media_type: "gif" }).problems).toEqual(["Choose a TikTok post type: video or photo."]);
  });

  it("blocks private branded content", () => {
    expect(check({ ...direct, disclose_branded_content: true }, [media()])).toEqual([
      "Branded content on TikTok cannot be private; choose a wider audience or turn off branded content.",
    ]);
  });
});

describe("LinkedIn", () => {
  const linkedin = { kind: "linkedin" } as const;
  it("follows the media: text, images or one video", () => {
    expect(check(linkedin, [])).toEqual([]);
    expect(check(linkedin, [], "  ")).toEqual(["Write the text for this LinkedIn post."]);
    expect(check(linkedin, [image(), image({ mime_type: "image/png" }), image({ mime_type: "image/gif" })])).toEqual([]);
    expect(check(linkedin, [media()])).toEqual([]);
    expect(check(linkedin, [media(), image()])).toEqual(["A LinkedIn video post needs exactly 1 video; this post has 2 files."]);
    expect(check({ ...linkedin, media_type: "text" }, [image()])).toEqual(["A LinkedIn text post cannot include media; choose image or video instead."]);
  });

  it("checks limits", () => {
    expect(check(linkedin, [], "x".repeat(3001))).toEqual(["LinkedIn posts can be at most 3,000 characters; this one is 3,001."]);
    expect(check(linkedin, Array.from({ length: 21 }, () => image()))).toEqual(["LinkedIn posts can have at most 20 images; this one has 21."]);
    expect(check(linkedin, [image({ mime_type: "image/webp" })])).toEqual(["LinkedIn images must be JPEG or PNG or GIF; photo.jpg is image/webp."]);
    expect(check(linkedin, [media({ mime_type: "video/quicktime" })])).toEqual(["LinkedIn videos must be MP4; clip.mp4 is video/quicktime."]);
    expect(check(linkedin, [media({ duration_seconds: 2 })])).toEqual(["LinkedIn videos must be at least 3 seconds; clip.mp4 is 2 seconds."]);
    expect(check(linkedin, [media({ size_bytes: 600 * 1024 * 1024 })])).toEqual(["LinkedIn videos can be at most 500 MB; clip.mp4 is 600 MB."]);
  });

  it("uses its own text, defaults to public and refuses unknown values", () => {
    expect(check({ ...linkedin, text: "" }, [])).toEqual(["Write the text for this LinkedIn post."]);
    expect(normalizeOptions("linkedin", {}).options).toEqual({ kind: "linkedin", media_type: undefined, text: undefined, title: undefined, visibility: "PUBLIC" });
    expect(normalizeOptions("linkedin", { visibility: "FRIENDS" }).problems).toEqual(["Choose who can see the LinkedIn post: PUBLIC or CONNECTIONS."]);
    expect(normalizeOptions("linkedin", { media_type: "reel" }).problems).toEqual(["Choose a LinkedIn post type: text, image or video."]);
  });
});

describe("Bluesky", () => {
  const bluesky = { kind: "bluesky" } as const;
  it("follows the media: text, up to 4 images or one video", () => {
    expect(check(bluesky, [])).toEqual([]);
    expect(check(bluesky, [], " ")).toEqual(["Write the text for this Bluesky post."]);
    expect(check(bluesky, [image(), image({ mime_type: "image/webp" }), image({ mime_type: "image/png" }), image({ mime_type: "image/gif" })])).toEqual([]);
    expect(check(bluesky, Array.from({ length: 5 }, () => image()))).toEqual(["Bluesky posts can have at most 4 images; this one has 5."]);
    expect(check(bluesky, [media()])).toEqual([]);
    expect(check(bluesky, [media({ duration_seconds: 200 })])).toEqual(["Bluesky videos can be at most 3 minutes; clip.mp4 is 3 min 20 s."]);
    expect(check(bluesky, [media({ size_bytes: 150 * 1024 * 1024 })])).toEqual(["Bluesky videos can be at most 100 MB; clip.mp4 is 150 MB."]);
    expect(check({ ...bluesky, cover_time_ms: 0 }, [media()])).toEqual(["Bluesky makes its own video thumbnail."]);
  });

  it("counts characters the way people see them", () => {
    expect(check(bluesky, [], "👩‍👩‍👧".repeat(300))).toEqual([]);
    expect(check(bluesky, [], "x".repeat(301))).toEqual(["Bluesky posts can be at most 300 characters; this one is 301."]);
  });

  it("takes its own text and one description per image", () => {
    expect(normalizeOptions("bluesky", { text: "hi", alt_text: ["a", "b"] }).options).toEqual({ kind: "bluesky", media_type: undefined, text: "hi", alt_text: ["a", "b"] });
    expect(normalizeOptions("bluesky", { alt_text: [1] }).problems[0]).toMatch(/alt_text is a list/);
    expect(normalizeOptions("bluesky", { media_type: "reel" }).problems).toEqual(["Choose a Bluesky post type: text, image or video."]);
  });
});

describe("X", () => {
  const x = { kind: "x" } as const;
  it("follows the media and checks X's limits", () => {
    expect(check(x, [])).toEqual([]);
    expect(check(x, Array.from({ length: 4 }, () => image()))).toEqual([]);
    expect(check(x, Array.from({ length: 5 }, () => image()))).toEqual(["X posts can have at most 4 images; this one has 5."]);
    expect(check(x, [image({ mime_type: "image/gif" }), image()])).toEqual(["An X post with a GIF can have only that one GIF."]);
    expect(check(x, [image({ size_bytes: 6 * 1024 * 1024 })])).toEqual(["X images can be at most 5 MB; photo.jpg is 6.0 MB."]);
    expect(check(x, [media({ duration_seconds: 150 })])).toEqual(["X videos can be at most 2 min 20 s; clip.mp4 is 2 min 30 s."]);
  });

  it("counts links as 23 characters", () => {
    expect(check(x, [], `${"a".repeat(256)} https://example.com/${"p".repeat(100)}`)).toEqual([]);
    expect(check(x, [], "a".repeat(281))).toEqual(["X posts can be at most 280 characters (links count as 23, emoji as 2); this one counts as 281."]);
  });
});

it("refuses media that is not ready", () => {
  expect(check({ kind: "instagram", media_type: "image" }, [image({ status: "processing" })])).toEqual(["photo.jpg is still being checked; only ready media can be posted."]);
});

describe("video covers", () => {
  const coverImg = image({ id: "c1", name: "cover.jpg", height: 1920 });
  const withCover = (options: DestinationOptions, files: MediaFacts[], cover?: MediaFacts) => destinationProblems({ options, caption: "Hi", media: files, cover });
  const reel = { kind: "instagram", media_type: "reel" } as const;
  const tiktokDirect = { kind: "tiktok", delivery_mode: "direct", privacy_level: "SELF_ONLY" } as const;

  it("reads cover_media_id and cover_time_ms, and refuses bad values", () => {
    expect(normalizeOptions("youtube", { privacy_status: "public", cover_time_ms: 4200 }).options).toMatchObject({ kind: "youtube", cover_time_ms: 4200 });
    expect(normalizeOptions("instagram", { media_type: "reel", cover_media_id: "11111111-2222-4333-8444-555555555555" }).options).toMatchObject({ cover_media_id: "11111111-2222-4333-8444-555555555555" });
    expect(normalizeOptions("instagram", { media_type: "reel", cover_media_id: "nope", cover_time_ms: -1 }).problems).toEqual([
      "cover_media_id must be the id of an image in your media library.",
      "cover_time_ms must be a whole number of milliseconds from the start of the video, 0 or more.",
    ]);
  });

  it("lets Instagram Reels and YouTube use an image or a frame", () => {
    expect(withCover({ ...reel, cover_media_id: "c1" }, [media()], coverImg)).toEqual([]);
    expect(withCover({ ...reel, cover_time_ms: 2000 }, [media()])).toEqual([]);
    expect(withCover({ kind: "youtube", title: "T", privacy_status: "public", cover_media_id: "c1" }, [media()], coverImg)).toEqual([]);
    expect(withCover({ kind: "youtube", title: "T", privacy_status: "public", cover_time_ms: 0 }, [media()])).toEqual([]);
  });

  it("explains what each other destination can't do", () => {
    expect(withCover({ ...tiktokDirect, cover_media_id: "c1" }, [media()], coverImg)).toEqual(["TikTok doesn't accept a cover image; pick a frame of the video instead."]);
    expect(withCover({ ...tiktokDirect, cover_time_ms: 1000 }, [media()])).toEqual([]);
    expect(withCover({ kind: "tiktok", delivery_mode: "inbox", cover_time_ms: 1000 }, [media()])).toEqual(["Post Social can't set the cover of a TikTok draft; choose it in TikTok before posting."]);
    expect(withCover({ kind: "facebook", media_type: "reel", cover_time_ms: 1000 }, [media()])).toEqual(["Post Social can't set a Facebook video cover yet; Facebook uses its own thumbnail."]);
    expect(withCover({ kind: "threads", media_type: "video", cover_time_ms: 1000 }, [media()])).toEqual(["Threads doesn't support custom covers."]);
    expect(withCover({ kind: "instagram", media_type: "image", cover_time_ms: 0 }, [image()])).toEqual(["Covers apply to Instagram Reels only."]);
  });

  it("checks the image and the frame time", () => {
    expect(withCover({ ...reel, cover_media_id: "c1", cover_time_ms: 0 }, [media()], coverImg)).toEqual(["Choose a cover image or a cover frame, not both."]);
    expect(withCover({ ...reel, cover_media_id: "c1" }, [media()], media({ id: "c1", name: "other.mp4" }))).toEqual(["The cover must be an image; other.mp4 is a video."]);
    expect(withCover({ ...reel, cover_media_id: "c1" }, [media()], image({ name: "anim.gif", mime_type: "image/gif" }))).toEqual(["The cover image must be JPEG, PNG or WebP; anim.gif is image/gif."]);
    expect(withCover({ ...reel, cover_time_ms: 31_000 }, [media({ duration_seconds: 30 })])).toEqual(["The cover frame is at 31.0s, but the video is 30.0s long."]);
  });
});
