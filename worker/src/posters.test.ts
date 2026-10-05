import { describe, expect, it, vi } from "vitest";
import { makePosters, posterKey } from "./posters";

describe("video posters", () => {
  it("saves the poster next to the video", () => {
    expect(posterKey("workspaces/w/media/m/clip.mp4")).toBe("workspaces/w/media/m/poster.jpg");
  });

  it("makes a frame for each video that needs one and records it; a failure doesn't stop the rest", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const sql = vi.fn(async (query: string, params: unknown[]) => {
      calls.push([query, params]);
      if (query.includes("poster_attempted_at = now()")) {
        return [
          { id: "a", storage_key: "workspaces/w/media/a/a.mp4", duration_seconds: "42" },
          { id: "b", storage_key: "workspaces/w/media/b/b.mp4", duration_seconds: "1" },
        ];
      }
      return [];
    });
    const put = vi.fn(async () => {});
    const r2 = { presignGet: async (key: string) => `https://r2.example/${key}`, put } as never;
    const extract = vi.fn(async (url: string, at: number) => {
      if (url.includes("/b/")) throw new Error("broken file");
      expect(at).toBe(1); // long videos: a second in, past any black first frame
      return new Uint8Array([1, 2, 3]);
    });
    expect(await makePosters(sql as never, r2, extract)).toBe(1);
    expect(put).toHaveBeenCalledWith("workspaces/w/media/a/poster.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    expect(calls.some(([q, p]) => q.includes("SET poster_key") && p[0] === "a")).toBe(true);
    expect(calls.some(([q, p]) => q.includes("SET poster_key") && p[0] === "b")).toBe(false);
  });
});
