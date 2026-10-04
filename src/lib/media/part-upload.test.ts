// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, uploadParts, type PutPart } from "./part-upload";

const parts = (count: number) => Array.from({ length: count }, (_, i) => ({ part_number: i + 1, url: `u${i + 1}` }));

describe("uploadParts", () => {
  it("sends each slice to its own URL and returns ETags in order", async () => {
    const file = new Blob(["aaaa", "bbbb", "cc"]);
    const seen: Record<string, string> = {};
    const put: PutPart = async (url, body, onProgress) => {
      seen[url] = await body.text();
      onProgress(body.size);
      return `"etag-${url}"`;
    };
    const result = await uploadParts({ file, partSize: 4, parts: parts(3), putPart: put });
    expect(seen).toEqual({ u1: "aaaa", u2: "bbbb", u3: "cc" });
    expect(result).toEqual([
      { part_number: 1, etag: '"etag-u1"' },
      { part_number: 2, etag: '"etag-u2"' },
      { part_number: 3, etag: '"etag-u3"' },
    ]);
  });

  it("never runs more than the allowed number of parts at once", async () => {
    let running = 0;
    let peak = 0;
    const put: PutPart = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return '"e"';
    };
    await uploadParts({ file: new Blob([new Uint8Array(100)]), partSize: 10, parts: parts(10), putPart: put, concurrency: 3 });
    expect(peak).toBe(3);
  });

  it("retries a failed part and reports progress up to 100%", async () => {
    let failures = 1;
    const progress: number[] = [];
    const put: PutPart = async (_url, body, onProgress) => {
      onProgress(body.size / 2);
      if (failures-- > 0) throw new Error("flaky network");
      return '"ok"';
    };
    await uploadParts({ file: new Blob(["12345678"]), partSize: 8, parts: parts(1), putPart: put, onProgress: (f) => progress.push(f) });
    expect(progress.at(-1)).toBe(1);
    expect(progress).toContain(0); // progress resets while the failed part restarts
  });

  it("gives up after the retries and when cancelled", async () => {
    const failing: PutPart = async () => {
      throw new Error("down");
    };
    await expect(uploadParts({ file: new Blob(["x"]), partSize: 1, parts: parts(1), putPart: failing, retries: 1 })).rejects.toThrow("down");

    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadParts({ file: new Blob(["x"]), partSize: 1, parts: parts(1), putPart: failing, signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
  });
});

describe("uploadParts when a part fails for good", () => {
  it("cancels the other parts that are still uploading", async () => {
    const cancelled: string[] = [];
    const put: PutPart = (url, _body, _onProgress, signal) =>
      new Promise((resolve, reject) => {
        if (url === "u1") return reject(new Error("part 1 broken"));
        signal.addEventListener("abort", () => {
          cancelled.push(url);
          reject(new DOMException("cancelled", "AbortError"));
        });
      });
    await expect(uploadParts({ file: new Blob([new Uint8Array(30)]), partSize: 10, parts: parts(3), putPart: put, retries: 0, concurrency: 3 })).rejects.toThrow(
      "part 1 broken",
    );
    expect(cancelled.sort()).toEqual(["u2", "u3"]);
  });
});

describe("formatting", () => {
  it("formats sizes and durations for people", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(500 * 1024 * 1024)).toBe("500 MB");
    expect(formatDuration(65.4)).toBe("1:05");
    expect(formatDuration(null)).toBeNull();
  });
});
