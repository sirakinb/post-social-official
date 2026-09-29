import { describe, expect, it } from "vitest";
import { channelText, destinationProof, formatScheduleTime, isTikTokDraft, type ExtendedDestinationOptions } from "./post-preview";

const tiktokBase = {
  kind: "tiktok" as const,
  privacyLevel: "SELF_ONLY",
  commentEnabled: true,
  duetEnabled: false,
  stitchEnabled: false,
  disclosureEnabled: false,
  yourBrandEnabled: false,
  brandedContentEnabled: false,
  creatorInfoCheckedAt: 0,
  creatorInfoSnapshot: { nickname: "Creator", maxVideoDurationSec: 60, canPost: true, privacyLevelOptions: ["SELF_ONLY"] },
};

describe("post preview helpers", () => {
  it("describes direct TikTok posts with their privacy and interaction settings", () => {
    expect(destinationProof(tiktokBase)).toBe("self only · Comments on · Duet off · Stitch off · No content disclosure");
  });

  it("describes TikTok drafts and flags them", () => {
    const draft: ExtendedDestinationOptions = { ...tiktokBase, deliveryMode: "inbox" };
    expect(isTikTokDraft(draft)).toBe(true);
    expect(isTikTokDraft(tiktokBase)).toBe(false);
    expect(isTikTokDraft(undefined)).toBe(false);
    expect(destinationProof(draft)).toMatch(/Draft in your TikTok inbox/);
  });

  it("uses channel-specific wording when there is some, and the shared caption otherwise", () => {
    expect(channelText({ kind: "instagram", mediaType: "reel", caption: "IG only" }, "Shared")).toEqual({ label: "Instagram caption", text: "IG only" });
    expect(channelText({ kind: "instagram", mediaType: "reel" }, "Shared")).toEqual({ label: "Instagram caption (shared)", text: "Shared" });
    expect(channelText({ kind: "threads", mediaType: "text", text: "Short take" }, "Shared")).toEqual({ label: "Threads text", text: "Short take" });
    expect(channelText({ kind: "facebook", mediaType: "feed", message: "FB words" }, "Shared")?.text).toBe("FB words");
    expect(channelText({ kind: "youtube", title: "My Short", privacyStatus: "public" }, "Shared")).toEqual({ label: "YouTube title", text: "My Short" });
  });

  it("labels the TikTok draft caption as something to paste", () => {
    expect(channelText({ ...tiktokBase, deliveryMode: "inbox" }, "Hello")).toEqual({ label: "Caption to paste in TikTok", text: "Hello" });
  });

  it("formats the schedule time with a time zone", () => {
    expect(formatScheduleTime(Date.UTC(2026, 8, 29, 3, 40))).toMatch(/2026/);
    expect(formatScheduleTime(Date.UTC(2026, 8, 29, 3, 40))).toMatch(/[A-Z]{2,5}|GMT/);
  });
});
