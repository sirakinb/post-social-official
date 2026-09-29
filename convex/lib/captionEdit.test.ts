import { describe, expect, it } from "vitest";
import { captionLimit, captionProblems, isCaptionEditable, planCaptionEdit } from "./captionEdit";

describe("planCaptionEdit", () => {
  it("edits drafts and posts still awaiting approval in place", () => {
    expect(planCaptionEdit({ status: "draft", policy: "confirm_each", sending: false })).toEqual({ kind: "in_place" });
    expect(planCaptionEdit({ status: "awaiting_approval", policy: "confirm_each", sending: false })).toEqual({ kind: "in_place" });
  });

  it("sends a human-approved scheduled post back for approval", () => {
    for (const policy of ["confirm_each", "approve_after_draft"] as const) {
      expect(planCaptionEdit({ status: "scheduled", policy, sending: false })).toEqual({ kind: "reapproval" });
      expect(planCaptionEdit({ status: "approved", policy, sending: false })).toEqual({ kind: "reapproval" });
    }
  });

  it("keeps an autonomous scheduled post scheduled", () => {
    expect(planCaptionEdit({ status: "scheduled", policy: "autonomous", sending: false })).toEqual({ kind: "in_place" });
  });

  it("blocks edits once sending has started, whatever the status says", () => {
    expect(planCaptionEdit({ status: "processing", policy: "autonomous", sending: false }).kind).toBe("blocked");
    expect(planCaptionEdit({ status: "scheduled", policy: "autonomous", sending: true }).kind).toBe("blocked");
  });

  it("blocks published, failed and cancelled posts", () => {
    for (const status of ["published", "partially_published", "failed", "cancelled"]) {
      expect(planCaptionEdit({ status, policy: "autonomous", sending: false }).kind).toBe("blocked");
    }
  });

  it("reports which statuses are editable", () => {
    expect(["draft", "awaiting_approval", "approved", "scheduled"].every(isCaptionEditable)).toBe(true);
    expect(["processing", "published", "failed", "cancelled"].some(isCaptionEditable)).toBe(false);
  });
});

describe("captionProblems", () => {
  const tiktok = { options: { kind: "tiktok" } };
  const instagramShared = { options: { kind: "instagram" } };
  const instagramCustom = { options: { kind: "instagram", caption: "own words" } };

  it("rejects an empty or whitespace caption", () => {
    expect(captionProblems("   ", [tiktok])[0]).toMatch(/Add a caption/);
  });

  it("enforces the TikTok 2,200 character limit only when TikTok is a destination", () => {
    const long = "a".repeat(2201);
    expect(captionProblems(long, [tiktok])).toContain("Shorten the TikTok caption to 2,200 characters or fewer.");
    expect(captionProblems(long, [{ options: { kind: "threads" } }])).toEqual([]);
    expect(captionProblems("a".repeat(2200), [tiktok])).toEqual([]);
  });

  it("applies the Instagram limit only when Instagram reuses the shared caption", () => {
    const long = "a".repeat(2201);
    expect(captionProblems(long, [instagramShared])).toContain("Shorten the Instagram caption to 2,200 characters or fewer.");
    expect(captionProblems(long, [instagramCustom])).toEqual([]);
  });

  it("caps the caption at 10,000 characters", () => {
    expect(captionProblems("a".repeat(10_001), [{ options: { kind: "threads" } }])[0]).toMatch(/10,000/);
  });
});

describe("captionLimit", () => {
  it("uses the strictest limit among the destinations", () => {
    expect(captionLimit([{ options: { kind: "threads" } }])).toBe(10_000);
    expect(captionLimit([{ options: { kind: "threads" }}, { options: { kind: "tiktok" } }])).toBe(2_200);
    expect(captionLimit([{ options: { kind: "instagram", caption: "custom" } }])).toBe(10_000);
    expect(captionLimit([{ options: { kind: "instagram" } }])).toBe(2_200);
  });
});
