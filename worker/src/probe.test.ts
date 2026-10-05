// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import mediaInfoFactory from "mediainfo.js";
import { describe, expect, it } from "vitest";
import { interpretProbe, type MediaInfoResult } from "../../backend/lib/media/probe-result";
import { rangeReader } from "./probe";

// A fake storage server over a buffer: answers Range requests with 206, counts requests,
// and can be told to hang (never answer until aborted) or fail for the first few calls.
function storage(data: Uint8Array<ArrayBuffer>, behaviour: { hangFirst?: number; failFirst?: number; ignoreRange?: boolean } = {}) {
  let calls = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls++;
    if (calls <= (behaviour.hangFirst ?? 0)) {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    }
    if (calls <= (behaviour.failFirst ?? 0)) throw new TypeError("fetch failed");
    if (behaviour.ignoreRange) return new Response(data.slice(), { status: 200 });
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec((init.headers as Record<string, string>).Range)!;
    return new Response(data.slice(Number(from), Number(to) + 1), { status: 206 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe("rangeReader", () => {
  it("serves many small reads from a few large requests", async () => {
    const data = bytes(10_000);
    const store = storage(data);
    const read = rangeReader("u", data.length, { fetchImpl: store.fetchImpl, windowBytes: 4096 });
    for (let offset = 0; offset < 4096; offset += 100) expect(await read(100, offset)).toEqual(data.slice(offset, offset + 100));
    expect(store.calls()).toBe(2); // the last read crosses the first window's edge
  });

  it("returns nothing past the end of the file", async () => {
    const read = rangeReader("u", 10, { fetchImpl: storage(bytes(10)).fetchImpl });
    expect(await read(5, 10)).toEqual(new Uint8Array());
    expect(await read(50, 8)).toEqual(bytes(10).slice(8));
  });

  it("gives up on a stalled request and retries it", async () => {
    const data = bytes(1000);
    const store = storage(data, { hangFirst: 1 });
    const read = rangeReader("u", data.length, { fetchImpl: store.fetchImpl, readTimeoutMs: 20 });
    expect(await read(10, 0)).toEqual(data.slice(0, 10));
    expect(store.calls()).toBe(2);
  });

  it("fails after three attempts instead of waiting forever", async () => {
    const store = storage(bytes(1000), { failFirst: 99 });
    const read = rangeReader("u", 1000, { fetchImpl: store.fetchImpl });
    await expect(read(10, 0)).rejects.toThrow("fetch failed");
    expect(store.calls()).toBe(3);
  }, 10_000);

  it("stops when the probe's deadline passes", async () => {
    const controller = new AbortController();
    const store = storage(bytes(1000), { hangFirst: 99 });
    const read = rangeReader("u", 1000, { fetchImpl: store.fetchImpl, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("deadline")), 20);
    await expect(read(10, 0)).rejects.toThrow();
    expect(store.calls()).toBe(1);
  });

  it("copes with a server that ignores the range and sends the whole file", async () => {
    const data = bytes(1000);
    const read = rangeReader("u", data.length, { fetchImpl: storage(data, { ignoreRange: true }).fetchImpl });
    expect(await read(10, 500)).toEqual(data.slice(500, 510));
  });
});

describe("probing through rangeReader with mediainfo", () => {
  const require = createRequire(import.meta.url);
  const wasm = path.join(path.dirname(require.resolve("mediainfo.js")), "..", "MediaInfoModule.wasm");
  const probe = async (input: Uint8Array) => {
    const data = new Uint8Array(input);
    const store = storage(data);
    const mediainfo = await mediaInfoFactory({ format: "object", locateFile: () => wasm });
    try {
      const result = await mediainfo.analyzeData(data.length, rangeReader("u", data.length, { fetchImpl: store.fetchImpl }));
      return { outcome: interpretProbe(result as unknown as MediaInfoResult, "video"), calls: store.calls() };
    } finally {
      mediainfo.close();
    }
  };

  it("reads a real video", async () => {
    const video = readFileSync(path.resolve(import.meta.dirname, "../../submission/meta/threads-submission-captioned-small.mp4"));
    const { outcome } = await probe(new Uint8Array(video));
    expect(outcome).toMatchObject({ ok: true, mediaType: "video" });
  });

  it("rejects random bytes quickly and with few requests", async () => {
    const { outcome, calls } = await probe(new Uint8Array(randomBytes(20 * 1024 * 1024)));
    expect(outcome.ok).toBe(false);
    expect(calls).toBeLessThan(10);
  });
});
