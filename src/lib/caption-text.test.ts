import { describe, expect, it } from "vitest";
import { tokenizeCaption, truncateCaption } from "./caption-text";
import { isKnownNonVertical, isVertical, mediaFit } from "./media-fit";

describe("tokenizeCaption", () => {
  it("separates hashtags and mentions from plain text", () => {
    expect(tokenizeCaption("Hi 👋 I'm Adzo #meetadzo with @aki.b!")).toEqual([
      { type: "text", value: "Hi 👋 I'm Adzo " },
      { type: "hashtag", value: "#meetadzo" },
      { type: "text", value: " with " },
      { type: "mention", value: "@aki.b" },
      { type: "text", value: "!" },
    ]);
  });

  it("handles captions with no tags and empty text", () => {
    expect(tokenizeCaption("plain words")).toEqual([{ type: "text", value: "plain words" }]);
    expect(tokenizeCaption("")).toEqual([]);
  });

  it("recognises non-English hashtags", () => {
    expect(tokenizeCaption("#café")[0]).toEqual({ type: "hashtag", value: "#café" });
  });
});

describe("truncateCaption", () => {
  it("leaves short captions alone", () => {
    expect(truncateCaption("short", 100)).toEqual({ text: "short", truncated: false });
  });

  it("cuts long captions at a word boundary and marks them truncated", () => {
    const result = truncateCaption("one two three four five six seven eight nine ten", 20);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("one two three four…");
    expect(result.text.length).toBeLessThanOrEqual(21);
  });

  it("cuts mid-word only when there is no reasonable boundary", () => {
    expect(truncateCaption("a".repeat(50), 10)).toEqual({ text: `${"a".repeat(10)}…`, truncated: true });
  });
});

describe("media fit", () => {
  it("treats about 9:16 as vertical", () => {
    expect(isVertical(768, 1344)).toBe(true);
    expect(isVertical(1080, 1920)).toBe(true);
    expect(isVertical(1920, 1080)).toBe(false);
    expect(isVertical(1090, 1096)).toBe(false);
    expect(isVertical(undefined, undefined)).toBe(false);
  });

  it("fills the screen for vertical media and letterboxes the rest", () => {
    expect(mediaFit(1080, 1920)).toBe("cover");
    expect(mediaFit(1920, 1080)).toBe("contain");
    expect(mediaFit(undefined, undefined)).toBe("contain");
  });

  it("warns only when the media is known to be non-vertical", () => {
    expect(isKnownNonVertical(1090, 1096)).toBe(true);
    expect(isKnownNonVertical(1080, 1920)).toBe(false);
    expect(isKnownNonVertical(undefined, undefined)).toBe(false);
  });
});
