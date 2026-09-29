import { describe, expect, it } from "vitest";
import { validateTikTokSelection, validateThreadsSelection } from "./composer";
import { TikTokCreatorInfo } from "@/lib/types";

const creator: TikTokCreatorInfo = {
  creatorId: "creator_1",
  nickname: "Sample Studio",
  privacyLevelOptions: [{ value: "SELF_ONLY", label: "Only you" }],
  commentAvailable: true,
  duetAvailable: true,
  stitchAvailable: true,
  maxVideoDurationSec: 60,
  canPost: true,
};

function video(name = "clip.mp4", type = "video/mp4", size = 100) {
  return new File([new Uint8Array(size)], name, { type });
}

describe("TikTok composer validation", () => {
  it("blocks publishing when creator_info says the account cannot post", () => {
    expect(validateTikTokSelection([], "Hello", { ...creator, canPost: false })[0]).toMatch(/cannot post right now/i);
  });

  it("rejects captions over the launch limit", () => {
    expect(validateTikTokSelection([], "a".repeat(2201), creator)).toContain(
      "Shorten the TikTok caption to 2,200 characters or fewer."
    );
  });

  it("rejects unsupported video types", () => {
    expect(validateTikTokSelection([{ file: video("clip.webm", "video/webm") }], "Hello", creator)[0]).toMatch(/not an MP4 or MOV/i);
  });

  it("rejects a video longer than the account allows", () => {
    expect(validateTikTokSelection([{ file: video(), durationSeconds: 61 }], "Hello", creator)[0]).toMatch(/longer than this TikTok account allows/i);
  });
});

describe("Threads composer validation", () => {
  it("rejects empty text when there is no caption fallback", () => {
    expect(validateThreadsSelection([], [], "", "")).toContain("Add text for Threads before publishing.");
  });

  it("accepts text from the main caption fallback", () => {
    expect(validateThreadsSelection([], [], "Hello Threads", "")).toHaveLength(0);
  });

  it("rejects text over 500 characters after fallback", () => {
    expect(validateThreadsSelection([], [], "a".repeat(501), "")).toContain(
      "Shorten the Threads text to 500 characters or fewer."
    );
    expect(validateThreadsSelection([], [], "Hello", "b".repeat(501))).toContain(
      "Shorten the Threads text to 500 characters or fewer."
    );
  });

  it("rejects video media", () => {
    expect(validateThreadsSelection([{ file: video() }], [], "Hello", "")[0]).toMatch(
      /Threads video publishing is not enabled in this version/i
    );
  });

  it("rejects more than one image", () => {
    const image = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });
    expect(validateThreadsSelection([{ file: image("a.png") }, { file: image("b.png") }], [], "Hello", "")).toContain(
      "Threads accepts one image in this version."
    );
  });

  it("accepts one image", () => {
    const image = new File([new Uint8Array(10)], "photo.png", { type: "image/png" });
    expect(validateThreadsSelection([{ file: image }], [], "Hello", "")).toHaveLength(0);
  });
});
