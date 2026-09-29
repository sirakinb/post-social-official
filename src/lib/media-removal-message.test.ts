import { describe, expect, it } from "vitest";
import { mediaRemovalMessage } from "./media-removal-message";

describe("mediaRemovalMessage", () => {
  it("describes permanent deletion when no post references are preserved", () => {
    expect(
      mediaRemovalMessage({
        deleted: true,
        removedFromLibrary: true,
        preservedPostReferences: 0,
      })
    ).toBe("The media file was permanently deleted.");
  });

  it("describes preservation when one or more posts reference the media", () => {
    expect(
      mediaRemovalMessage({
        deleted: false,
        removedFromLibrary: true,
        preservedPostReferences: 1,
      })
    ).toBe(
      "Removed from your library. Existing posts that use this media were preserved."
    );
  });

  it("describes preservation for multiple preserved post references", () => {
    expect(
      mediaRemovalMessage({
        deleted: false,
        removedFromLibrary: true,
        preservedPostReferences: 5,
      })
    ).toBe(
      "Removed from your library. Existing posts that use this media were preserved."
    );
  });
});
