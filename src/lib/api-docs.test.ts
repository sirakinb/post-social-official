import { describe, expect, it } from "vitest";
import { VIDEO_COVERS_HELP } from "../../backend/lib/api/operations";
import { llmsText } from "./api-docs";

describe("llms.txt video covers", () => {
  it("has a Video covers section with the same text the API gives AI apps", () => {
    const text = llmsText();
    expect(text).toContain("## Video covers");
    expect(text).toContain(VIDEO_COVERS_HELP);
    expect(VIDEO_COVERS_HELP).toMatch(/cover_media_id/);
    expect(VIDEO_COVERS_HELP).toMatch(/cover_time_ms/);
    expect(VIDEO_COVERS_HELP).toMatch(/TikTok direct posts take a frame only/);
  });
});
