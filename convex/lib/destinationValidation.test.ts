import { describe, expect, it } from "vitest";
import { validateDestinationForPublish } from "./destinationValidation";

const now = 1_000_000;
const tiktok = {
  kind: "tiktok" as const,
  privacyLevel: "SELF_ONLY",
  commentEnabled: false,
  duetEnabled: false,
  stitchEnabled: false,
  disclosureEnabled: false,
  yourBrandEnabled: false,
  brandedContentEnabled: false,
  creatorInfoCheckedAt: now,
  creatorInfoSnapshot: {
    nickname: "Creator",
    maxVideoDurationSec: 60,
    canPost: true,
    privacyLevelOptions: ["SELF_ONLY"],
    commentAvailable: true,
    duetAvailable: true,
    stitchAvailable: true,
  },
};

describe("destination publish validation", () => {
  it("accepts one compliant TikTok video", () => {
    expect(() => validateDestinationForPublish({ options: tiktok, media: [{ mediaType: "video", mimeType: "video/mp4", durationSeconds: 30 }], caption: "Hello", now })).not.toThrow();
  });

  it("accepts a TikTok draft upload without privacy, disclosure or fresh creator info", () => {
    const inbox = { ...tiktok, deliveryMode: "inbox" as const, privacyLevel: "", disclosureEnabled: false, yourBrandEnabled: true, creatorInfoCheckedAt: now - 60 * 60 * 1000, creatorInfoSnapshot: { ...tiktok.creatorInfoSnapshot, canPost: false } };
    expect(() => validateDestinationForPublish({ options: inbox, media: [{ mediaType: "video", mimeType: "video/mp4", durationSeconds: 30 }], caption: "", now })).not.toThrow();
  });

  it("limits TikTok draft uploads to a single valid video", () => {
    const inbox = { ...tiktok, deliveryMode: "inbox" as const };
    expect(() => validateDestinationForPublish({ options: inbox, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "", now })).toThrow("exactly one video");
    expect(() => validateDestinationForPublish({ options: inbox, media: [{ mediaType: "video", mimeType: "video/mp4" }, { mediaType: "video", mimeType: "video/mp4" }], caption: "", now })).toThrow("exactly one video");
    expect(() => validateDestinationForPublish({ options: inbox, media: [{ mediaType: "video", mimeType: "video/webm" }], caption: "", now })).toThrow("MP4 or MOV");
    expect(() => validateDestinationForPublish({ options: inbox, media: [{ mediaType: "video", mimeType: "video/mp4", durationSeconds: 61 }], caption: "", now })).toThrow("longer than this TikTok account allows");
  });

  it("still enforces direct-post rules when delivery mode is direct", () => {
    expect(() => validateDestinationForPublish({ options: { ...tiktok, deliveryMode: "direct" as const, privacyLevel: "" }, media: [{ mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).toThrow("Choose a TikTok privacy setting");
  });

  it("rejects mixed TikTok video and photo media", () => {
    expect(() => validateDestinationForPublish({ options: tiktok, media: [{ mediaType: "video", mimeType: "video/mp4" }, { mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).toThrow("one video");
  });

  it("rejects unavailable TikTok interaction settings", () => {
    expect(() => validateDestinationForPublish({ options: { ...tiktok, commentEnabled: true, creatorInfoSnapshot: { ...tiktok.creatorInfoSnapshot, commentAvailable: false } }, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).toThrow("Comments are not available");
  });

  it("rejects stale or invented TikTok creator choices", () => {
    expect(() => validateDestinationForPublish({ options: { ...tiktok, privacyLevel: "PUBLIC_TO_EVERYONE" }, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).toThrow("currently allows");
    expect(() => validateDestinationForPublish({ options: { ...tiktok, creatorInfoCheckedAt: now - 10 * 60 * 1000 - 1 }, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).toThrow("Refresh TikTok");
  });

  it("rejects hidden TikTok brand disclosures", () => {
    expect(() => validateDestinationForPublish({ options: { ...tiktok, yourBrandEnabled: true }, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).toThrow("Turn on content disclosure");
  });

  it("enforces Instagram image, Reel, and carousel media shape", () => {
    expect(() => validateDestinationForPublish({ options: { kind: "instagram", mediaType: "image" }, media: [{ mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).toThrow("Choose an image");
    expect(() => validateDestinationForPublish({ options: { kind: "instagram", mediaType: "reel" }, media: [{ mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).not.toThrow();
    expect(() => validateDestinationForPublish({ options: { kind: "instagram", mediaType: "carousel" }, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).toThrow("2 to 10");
  });

  it("allows a Facebook text feed and enforces the one-image build boundary", () => {
    expect(() => validateDestinationForPublish({ options: { kind: "facebook", mediaType: "feed" }, media: [], caption: "Hello", now })).not.toThrow();
    expect(() => validateDestinationForPublish({ options: { kind: "facebook", mediaType: "image" }, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).not.toThrow();
    expect(() => validateDestinationForPublish({ options: { kind: "facebook", mediaType: "video" }, media: [{ mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).toThrow("not enabled");
  });

  it("validates Threads text and single-image posts", () => {
    expect(() => validateDestinationForPublish({ options: { kind: "threads", mediaType: "text", text: "Hello Threads" }, media: [], caption: "Hello", now })).not.toThrow();
    expect(() => validateDestinationForPublish({ options: { kind: "threads", mediaType: "image", text: "Hello Threads" }, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).not.toThrow();
    expect(() => validateDestinationForPublish({ options: { kind: "threads", mediaType: "text", text: "" }, media: [], caption: "Hello", now })).toThrow("Write something");
    expect(() => validateDestinationForPublish({ options: { kind: "threads", mediaType: "text", text: "x".repeat(501) }, media: [], caption: "Hello", now })).toThrow("500");
    expect(() => validateDestinationForPublish({ options: { kind: "threads", mediaType: "image", text: "Hello" }, media: [{ mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).toThrow("requires exactly one image");
  });

  it("validates a YouTube Short as one titled video", () => {
    expect(() => validateDestinationForPublish({ options: { kind: "youtube", title: "My Short", privacyStatus: "public" }, media: [{ mediaType: "video", mimeType: "video/mp4", durationSeconds: 30 }], caption: "Hello", now })).not.toThrow();
    expect(() => validateDestinationForPublish({ options: { kind: "youtube", title: "  ", privacyStatus: "public" }, media: [{ mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).toThrow("Add a title");
    expect(() => validateDestinationForPublish({ options: { kind: "youtube", title: "x".repeat(101), privacyStatus: "public" }, media: [{ mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).toThrow("100 characters");
    expect(() => validateDestinationForPublish({ options: { kind: "youtube", title: "My Short", description: "x".repeat(5001), privacyStatus: "unlisted" }, media: [{ mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).toThrow("5,000 characters");
    expect(() => validateDestinationForPublish({ options: { kind: "youtube", title: "My Short", privacyStatus: "public" }, media: [{ mediaType: "image", mimeType: "image/jpeg" }], caption: "Hello", now })).toThrow("exactly one video");
    expect(() => validateDestinationForPublish({ options: { kind: "youtube", title: "My Short", privacyStatus: "public" }, media: [{ mediaType: "video", mimeType: "video/mp4" }, { mediaType: "video", mimeType: "video/mp4" }], caption: "Hello", now })).toThrow("exactly one video");
  });
});
