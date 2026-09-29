import { describe, expect, it } from "vitest";
import {
  buildTikTokChunkPlan,
  buildInstagramCarouselPlan,
  classifyTikTokStatus,
  rateWindowStart,
  TIKTOK_MAX_CHUNK_BYTES,
  TIKTOK_MAX_VIDEO_BYTES,
  platformResponseError,
  assertConnectionWorkspace,
  canPublishToFacebookPage,
  classifyThreadsContainerStatus,
  nextMidnightPacific,
} from "./platformRules";

describe("platform publishing rules", () => {
  it("uploads a small TikTok video as one exact chunk", () => {
    expect(buildTikTokChunkPlan(12_345)).toEqual({
      videoSize: 12_345,
      chunkSize: 12_345,
      totalChunkCount: 1,
      ranges: [{ start: 0, end: 12_344, length: 12_345 }],
    });
  });

  it("splits a TikTok video at the 64 MB boundary without gaps", () => {
    const plan = buildTikTokChunkPlan(TIKTOK_MAX_CHUNK_BYTES + 17);
    expect(plan.totalChunkCount).toBe(2);
    expect(plan.ranges).toEqual([
      { start: 0, end: TIKTOK_MAX_CHUNK_BYTES - 1, length: TIKTOK_MAX_CHUNK_BYTES },
      { start: TIKTOK_MAX_CHUNK_BYTES, end: TIKTOK_MAX_CHUNK_BYTES + 16, length: 17 },
    ]);
  });

  it("rejects TikTok videos over 1 GB", () => {
    expect(() => buildTikTokChunkPlan(TIKTOK_MAX_VIDEO_BYTES + 1)).toThrow("video_too_large");
  });

  it("classifies TikTok completion, failure, processing, and timeout", () => {
    expect(classifyTikTokStatus({ status: "PUBLISH_COMPLETE", publicly_available_post_id: ["42"] }, 0, 1)).toEqual({ kind: "published", postId: "42" });
    expect(classifyTikTokStatus({ status: "FAILED", fail_reason: "spam_risk" }, 0, 1)).toEqual({ kind: "failed", reason: "spam_risk" });
    expect(classifyTikTokStatus({ status: "PROCESSING_UPLOAD" }, 0, 1)).toEqual({ kind: "processing" });
    expect(classifyTikTokStatus({ status: "PROCESSING_UPLOAD" }, 0, 10 * 60 * 1000 + 1)).toEqual({ kind: "timed_out" });
  });

  it("waits for Threads image containers and surfaces terminal preparation failures", () => {
    expect(classifyThreadsContainerStatus({ status: "FINISHED" })).toEqual({ kind: "ready" });
    expect(classifyThreadsContainerStatus({ status: "IN_PROGRESS" })).toEqual({ kind: "processing" });
    expect(classifyThreadsContainerStatus({ status: "ERROR", error_message: "Image could not be fetched" })).toEqual({
      kind: "failed",
      reason: "Image could not be fetched",
    });
    expect(classifyThreadsContainerStatus({ status: "EXPIRED" })).toEqual({
      kind: "failed",
      reason: "Threads could not prepare the image.",
    });
  });

  it("places calls in deterministic rate-limit windows", () => {
    expect(rateWindowStart(125_999, 60_000)).toBe(120_000);
    expect(rateWindowStart(180_000, 60_000)).toBe(180_000);
  });

  it("builds an Instagram carousel with ordered image and video children", () => {
    expect(buildInstagramCarouselPlan([
      { mediaType: "image", url: "https://example.com/one.jpg" },
      { mediaType: "video", url: "https://example.com/two.mp4" },
    ])).toEqual([
      { index: 0, mediaType: "image", url: "https://example.com/one.jpg" },
      { index: 1, mediaType: "video", url: "https://example.com/two.mp4" },
    ]);
  });

  it("rejects incomplete or oversized Instagram carousels", () => {
    expect(() => buildInstagramCarouselPlan([{ mediaType: "image", url: "https://example.com/one.jpg" }])).toThrow("carousel_needs_two_items");
    expect(() => buildInstagramCarouselPlan(Array.from({ length: 11 }, (_, index) => ({ mediaType: "image" as const, url: `https://example.com/${index}.jpg` })))).toThrow("carousel_too_many_items");
    expect(() => buildInstagramCarouselPlan([{ mediaType: "image", url: "https://example.com/one.jpg" }, { mediaType: "video" }])).toThrow("carousel_media_missing");
  });

  it("accepts TikTok's successful error-code envelope and rejects real platform errors", () => {
    expect(platformResponseError(true, 200, { code: "ok", message: "" })).toBeUndefined();
    expect(platformResponseError(true, 200, { code: "scope_not_authorized" })).toBe("scope_not_authorized");
    expect(platformResponseError(false, 503, undefined)).toBe("http_503");
  });

  it("blocks credential writes across workspace boundaries", () => {
    expect(() => assertConnectionWorkspace("workspace-a", "workspace-b")).toThrow("another workspace");
    expect(() => assertConnectionWorkspace("workspace-a", "workspace-a")).not.toThrow();
    expect(() => assertConnectionWorkspace(undefined, "workspace-a")).not.toThrow();
  });

  it("connects only Facebook Pages that explicitly grant content creation", () => {
    expect(canPublishToFacebookPage(["CREATE_CONTENT", "ANALYZE"])).toBe(true);
    expect(canPublishToFacebookPage(["MANAGE"])).toBe(true);
    expect(canPublishToFacebookPage(["PROFILE_PLUS_CREATE_CONTENT"])).toBe(true);
    expect(canPublishToFacebookPage(["PROFILE_PLUS_MANAGE"])).toBe(true);
    expect(canPublishToFacebookPage(["PROFILE_PLUS_FULL_CONTROL"])).toBe(true);
    expect(canPublishToFacebookPage(["PROFILE_PLUS_ANALYZE"])).toBe(false);
    expect(canPublishToFacebookPage(["ANALYZE"])).toBe(false);
    expect(canPublishToFacebookPage([])).toBe(false);
    expect(canPublishToFacebookPage(undefined)).toBe(false);
  });

  it("schedules YouTube quota retries just after the next Pacific midnight", () => {
    // 2026-08-04T19:00:00Z is noon Pacific (PDT, UTC-7); next reset is 07:00Z the next day.
    const noonPacific = Date.UTC(2026, 7, 4, 19, 0, 0);
    const retryAt = nextMidnightPacific(noonPacific);
    expect(retryAt).toBeGreaterThan(noonPacific);
    const expectedMidnight = Date.UTC(2026, 7, 5, 7, 0, 0);
    expect(retryAt).toBeGreaterThanOrEqual(expectedMidnight);
    expect(retryAt).toBeLessThanOrEqual(expectedMidnight + 2 * 60 * 1000);
  });
});
