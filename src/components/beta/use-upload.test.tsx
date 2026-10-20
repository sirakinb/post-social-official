import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ media: [] as Array<Record<string, unknown>>, puts: [] as string[], down: false }));
vi.mock("@/app/beta/(app)/media/actions", () => ({
  callMedia: async (payload: Record<string, unknown>) => {
    calls.media.push(payload);
    if (payload.action === "create_upload") return { ok: true, data: { media_id: "m1", part_size: 4, parts: [1, 2, 3].map((n) => ({ part_number: n, url: `u${n}` })) } };
    if (payload.action === "complete_upload") return { ok: true, data: {} };
    if (payload.action === "get") return { ok: true, data: { id: "m1", status: "ready", media_type: "video" } };
    return { ok: true, data: {} };
  },
}));
vi.mock("@/lib/media/part-upload", async (original) => ({
  ...(await original<typeof import("@/lib/media/part-upload")>()),
  xhrPutPart: async (url: string, body: Blob, onProgress: (n: number) => void) => {
    if (calls.down && url === "u2") throw new Error("Network error while uploading");
    calls.puts.push(url);
    onProgress(body.size);
    return `"e-${url}"`;
  },
}));

const { useUpload } = await import("./use-upload");

describe("useUpload", () => {
  it("pauses on a dropped connection and resumes with only the missing parts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ready = vi.fn();
    const { result } = renderHook(() => useUpload("w1", ready));
    const file = new File(["aaaabbbbcc"], "clip.mov", { type: "video/quicktime" });
    calls.down = true; // part 2 can't get through
    await act(async () => {
      const going = result.current.upload(file);
      await vi.advanceTimersByTimeAsync(5000);
      await going;
    });
    expect(result.current.uploads[0]).toMatchObject({ status: "paused" });
    expect(result.current.keepOpen).toBe(true);
    expect(calls.media.some((c) => c.action === "abort_upload")).toBe(false); // kept for resuming
    expect(calls.puts.sort()).toEqual(["u1", "u3"]);

    calls.down = false;
    await act(async () => {
      result.current.resume(result.current.uploads[0].key);
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(calls.puts.sort()).toEqual(["u1", "u2", "u3"]); // only the missing part was sent again
    expect(calls.media.filter((c) => c.action === "create_upload")).toHaveLength(1);
    expect(calls.media.find((c) => c.action === "complete_upload")?.parts).toEqual([
      { part_number: 1, etag: '"e-u1"' },
      { part_number: 2, etag: '"e-u2"' },
      { part_number: 3, etag: '"e-u3"' },
    ]);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(result.current.uploads).toEqual([]);
    vi.useRealTimers();
  });
});
