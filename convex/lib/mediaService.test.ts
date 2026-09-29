import { describe, expect, it } from "vitest";
import { validatedMediaMetadata } from "./mediaService";

const image = { fileName: "photo.jpg", mimeType: "image/jpeg", mediaType: "image" as const, sizeBytes: 1024, width: 1080, height: 1080 };

describe("media metadata validation", () => {
  it("accepts supported metadata and removes path components from names", () => {
    expect(validatedMediaMetadata({ ...image, fileName: "../../photo.jpg" }).fileName).toBe("photo.jpg");
  });

  it("rejects unsupported types and oversized files", () => {
    expect(() => validatedMediaMetadata({ ...image, mimeType: "image/svg+xml" })).toThrow(/JPEG/);
    expect(() => validatedMediaMetadata({ ...image, sizeBytes: 501 * 1024 * 1024 })).toThrow(/500 MB/);
  });

  it("rejects implausible dimensions, duration, and checksums", () => {
    expect(() => validatedMediaMetadata({ ...image, width: -1 })).toThrow(/width/);
    expect(() => validatedMediaMetadata({ ...image, checksumSha256: "not-a-checksum" })).toThrow(/SHA-256/);
    expect(() => validatedMediaMetadata({ fileName: "clip.mp4", mimeType: "video/mp4", mediaType: "video", sizeBytes: 1024, durationSeconds: 3601 })).toThrow(/60 minutes/);
  });
});
