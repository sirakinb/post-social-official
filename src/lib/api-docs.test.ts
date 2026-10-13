import { describe, expect, it } from "vitest";
import { llmsText } from "./api-docs";

describe("llms.txt", () => {
  it("explains video covers and which platforms take them", () => {
    const text = llmsText();
    expect(text).toContain("## Video covers");
    expect(text).toContain("cover_media_id");
    expect(text).toContain("cover_time_ms");
    expect(text).toMatch(/TikTok direct posts take a frame only/);
  });
});
