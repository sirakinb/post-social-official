import { describe, expect, it } from "vitest";
import { interpretProbe, signatureProblem } from "./probe-result";

const result = (...track: Array<Record<string, unknown>>) => ({ media: { track: track as never } });

describe("interpretProbe", () => {
  it("reads an MP4 video", () => {
    const outcome = interpretProbe(
      result({ "@type": "General", Format: "MPEG-4", Duration: "10.026" }, { "@type": "Video", Width: 1080, Height: "1920", Duration: 10.0 }),
      "video",
    );
    expect(outcome).toEqual({ ok: true, mimeType: "video/mp4", mediaType: "video", width: 1080, height: 1920, durationSeconds: 10 });
  });

  it("tells MOV apart from MP4", () => {
    const outcome = interpretProbe(
      result({ "@type": "General", Format: "MPEG-4", Format_Profile: "QuickTime" }, { "@type": "Video", Width: 640, Height: 480, Duration: 3.5 }),
      "video",
    );
    expect(outcome).toMatchObject({ ok: true, mimeType: "video/quicktime", durationSeconds: 3.5 });
  });

  it("reads images", () => {
    expect(interpretProbe(result({ "@type": "General", Format: "PNG" }, { "@type": "Image", Width: 64, Height: 48 }), "image")).toEqual({
      ok: true,
      mimeType: "image/png",
      mediaType: "image",
      width: 64,
      height: 48,
      durationSeconds: null,
    });
  });

  it("explains unusable files", () => {
    expect(interpretProbe(result({ "@type": "General" }), "video")).toMatchObject({ ok: false, reason: expect.stringMatching(/not a supported/) });
    expect(interpretProbe(result({ "@type": "General", Format: "MPEG-4" }, { "@type": "Audio" }), "video")).toMatchObject({
      ok: false,
      reason: "This file has no video in it.",
    });
    expect(interpretProbe(result({ "@type": "General", Format: "MPEG-4" }, { "@type": "Video", Width: 1, Height: 1 }), "video")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/no length/),
    });
    expect(interpretProbe(result({ "@type": "General", Format: "JPEG" }, { "@type": "Image" }), "video")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/sent as a video but is actually an image/),
    });
  });
});

describe("signatureProblem", () => {
  const bytes = (...values: Array<number | string>) =>
    Uint8Array.from(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

  it("accepts the opening bytes of every supported format", () => {
    expect(signatureProblem(bytes(0, 0, 0, 0x20, "ftypisom"))).toBeNull();
    expect(signatureProblem(bytes(0, 0, 0, 0x14, "ftypqt  "))).toBeNull();
    expect(signatureProblem(bytes(0, 0, 0, 8, "wide", 0, 0, 0, 0))).toBeNull(); // older QuickTime
    expect(signatureProblem(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f))).toBeNull();
    expect(signatureProblem(bytes(0xff, 0xd8, 0xff, 0xe0))).toBeNull();
    expect(signatureProblem(bytes(0x89, "PNG\r\n", 0x1a, "\n"))).toBeNull();
    expect(signatureProblem(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBeNull();
  });

  it("refuses anything else with a plain reason", () => {
    expect(signatureProblem(bytes("%PDF-1.7 hello"))).toMatch(/not a supported video or image/);
    expect(signatureProblem(bytes("RIFF", 0, 0, 0, 0, "WAVEfmt "))).not.toBeNull();
    expect(signatureProblem(new Uint8Array(64).map((_, i) => (i * 37) % 256))).not.toBeNull();
    expect(signatureProblem(new Uint8Array())).not.toBeNull();
  });
});
