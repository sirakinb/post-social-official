import { describe, expect, it } from "vitest";
import { MAX_MEDIA_BYTES, importUrlProblem, isPrivateAddress, mediaTypeFor, planParts, safeFileName, storageKey, uploadProblem } from "./rules";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.0.1", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1",
    "::ffff:10.0.0.1", "0:0:0:0:0:ffff:7f00:1", "64:ff9b::a00:1", "2002:7f00:1::", "[::1]",
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("treats hostnames as not-an-address (they are checked after DNS)", () => {
    expect(isPrivateAddress("example.com")).toBe(false);
  });
});

describe("importUrlProblem", () => {
  it("accepts ordinary https links", () => {
    expect(importUrlProblem("https://cdn.example.com/video.mp4?sig=1")).toBeNull();
  });

  it.each([
    ["http://example.com/a.mp4", /Only https/],
    ["ftp://example.com/a.mp4", /Only https/],
    ["https://user@example.com/a.mp4", /username or password/],
    ["https://example.com:8443/a.mp4", /standard https port/],
    ["https://localhost/a.mp4", /private or local/],
    ["https://printer.local/a.mp4", /private or local/],
    ["https://metadata.google.internal/x", /private or local/],
    ["https://intranet/a.mp4", /private or local/],
    ["https://2130706433/a.mp4", /private or local/], // 127.0.0.1 written as a number
    ["https://0x7f.1/a.mp4", /private or local/],
    ["https://[::1]/a.mp4", /private or local/],
    ["https://[::ffff:169.254.169.254]/", /private or local/],
    ["nonsense", /not a valid link/],
  ])("rejects %s", (url, reason) => {
    expect(importUrlProblem(url)).toMatch(reason);
  });
});

describe("uploads", () => {
  it("knows which files are supported", () => {
    expect(mediaTypeFor("video/mp4")).toBe("video");
    expect(mediaTypeFor("VIDEO/QuickTime; codecs=x")).toBe("video");
    expect(mediaTypeFor("image/webp")).toBe("image");
    expect(mediaTypeFor("image/gif")).toBeNull();
  });

  it("explains problems in plain language", () => {
    expect(uploadProblem({ fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: 10 })).toBeNull();
    expect(uploadProblem({ fileName: "", mimeType: "video/mp4", sizeBytes: 10 })).toMatch(/Choose a file/);
    expect(uploadProblem({ fileName: "a.gif", mimeType: "image/gif", sizeBytes: 10 })).toMatch(/not supported/);
    expect(uploadProblem({ fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: 0 })).toMatch(/empty/);
    expect(uploadProblem({ fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: MAX_MEDIA_BYTES + 1 })).toMatch(/1 GB/);
  });

  it("splits files into parts R2 accepts", () => {
    expect(planParts(1000)).toEqual({ partSize: 8 * 1024 * 1024, partCount: 1 });
    const gig = planParts(MAX_MEDIA_BYTES);
    expect(gig.partCount).toBeLessThanOrEqual(64);
    expect(gig.partSize * gig.partCount).toBeGreaterThanOrEqual(MAX_MEDIA_BYTES);
    expect(() => planParts(0)).toThrow();
  });

  it("keeps storage keys inside the workspace folder whatever the file is called", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\Clip Final (2).MOV")).toBe("Clip-Final-2-.MOV");
    expect(safeFileName("...")).toBe("file");
    expect(storageKey("ws", "m1", "../x.mp4")).toBe("workspaces/ws/media/m1/x.mp4");
  });
});
