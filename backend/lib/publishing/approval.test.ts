import { describe, expect, it } from "vitest";
import { needsApproval } from "./service";

describe("who needs to approve", () => {
  it("never holds back the person's own posts from the web app", () => {
    for (const policy of ["confirm_each", "approve_after_draft", "autonomous"] as const) {
      expect(needsApproval("ui", policy, "instagram")).toBe(false);
      expect(needsApproval("ui", policy, "tiktok")).toBe(false);
    }
  });

  it("holds an AI's posts unless the account is autonomous", () => {
    expect(needsApproval("mcp", "confirm_each", "facebook")).toBe(true);
    expect(needsApproval("api", "approve_after_draft", "threads")).toBe(true);
    expect(needsApproval("mcp", "autonomous", "facebook")).toBe(false);
  });

  it("always holds an AI's TikTok posts, even on autonomous accounts", () => {
    expect(needsApproval("mcp", "autonomous", "tiktok")).toBe(true);
    expect(needsApproval("api", "autonomous", "tiktok")).toBe(true);
  });
});
