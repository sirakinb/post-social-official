// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runNextJob, type WorkerDeps } from "./jobs";

type Call = { query: string; params: unknown[] };

// A fake database: hands out one claimed job and records every statement.
function fakeDeps(job: Record<string, unknown>, probe: WorkerDeps["probe"], options: { fileName?: string; lostJob?: boolean } = {}) {
  const calls: Call[] = [];
  const deleted: string[] = [];
  const asset = { id: "a1", storage_key: `ws/media/a1/${options.fileName ?? "clip.mp4"}`, size_bytes: 10, media_type: "video", mime_type: "video/mp4", source_url: null, file_name: options.fileName ?? "clip.mp4" };
  const sql = (async (query: string, params: unknown[] = []) => {
    calls.push({ query, params });
    if (query.includes("claim_media_job")) return [job];
    if (query.includes("FROM public.media_assets")) return [asset];
    if (query.includes("AS owns")) return [{ owns: true }];
    if (query.includes("SET status = 'ready'")) return options.lostJob ? [] : [{ id: "a1" }];
    return [];
  }) as WorkerDeps["sql"];
  const deps: WorkerDeps = {
    sql,
    r2: { head: async () => ({ sizeBytes: 10 }), delete: async (key: string) => void deleted.push(key) } as unknown as WorkerDeps["r2"],
    probe,
    download: async () => {
      throw new Error("not used");
    },
    log: () => undefined,
  };
  return { deps, calls, deleted };
}

const job = (attempt: number) => ({ id: "j1", workspace_id: "w1", media_asset_id: "a1", kind: "probe", attempt_count: attempt, max_attempts: 3 });
const renewals = (calls: Call[]) => calls.filter((c) => c.query.includes("SET lease_expires_at = now()"));

describe("runNextJob", () => {
  it("keeps renewing its claim while a long check runs, then stops", async () => {
    const ok = { ok: true as const, mimeType: "video/mp4", mediaType: "video" as const, width: 1, height: 1, durationSeconds: 1 };
    const { deps, calls } = fakeDeps(job(1), () => new Promise((r) => setTimeout(() => r(ok), 120)));
    await runNextJob(deps, 180, 25);
    const during = renewals(calls).length;
    expect(during).toBeGreaterThanOrEqual(3);
    expect(renewals(calls)[0].params).toEqual(["j1", 1, 180]);
    await new Promise((r) => setTimeout(r, 80));
    expect(renewals(calls).length).toBe(during);
  });

  it("fails a job whose worker died on every attempt instead of running it again", async () => {
    let probed = false;
    const { deps, calls } = fakeDeps(job(4), async () => {
      probed = true;
      return { ok: false, reason: "x" };
    });
    await runNextJob(deps);
    expect(probed).toBe(false);
    expect(calls.some((c) => c.query.includes("SET status = 'failed'") && c.params.some((p) => typeof p === "string" && p.startsWith("Processing kept failing. Try uploading the file again") && p.includes("contact support")))).toBe(true);
    expect(calls.some((c) => c.query.includes("UPDATE public.media_jobs") && c.params[1] === "failed")).toBe(true);
  });

  describe("MOV videos", () => {
    const mov = { ok: true as const, mimeType: "video/quicktime", mediaType: "video" as const, width: 1080, height: 1920, durationSeconds: 4, videoFormat: "HEVC" };
    const ready = (calls: Call[]) => calls.find((c) => c.query.includes("SET status = 'ready'"))!;

    it("are rewrapped as MP4 and the MOV is removed", async () => {
      const { deps, calls, deleted } = fakeDeps(job(1), async () => mov, { fileName: "IMG_0001.MOV" });
      const asked: unknown[] = [];
      deps.remux = async (...args) => {
        asked.push(args);
        return { key: "ws/media/a1/IMG_0001.mp4", fileName: "IMG_0001.mp4", sizeBytes: 9 };
      };
      await runNextJob(deps);
      expect(asked).toEqual([["ws/media/a1/IMG_0001.MOV", "IMG_0001.MOV", "HEVC"]]);
      const { params } = ready(calls);
      expect(params[3]).toBe("video/mp4");
      expect(params.slice(10)).toEqual(["ws/media/a1/IMG_0001.mp4", "IMG_0001.mp4", 9]);
      expect(deleted).toEqual(["ws/media/a1/IMG_0001.MOV"]);
    });

    it("stay MOV when rewrapping fails", async () => {
      const { deps, calls, deleted } = fakeDeps(job(1), async () => mov, { fileName: "IMG_0001.MOV" });
      deps.remux = async () => null;
      await runNextJob(deps);
      const { params } = ready(calls);
      expect(params[3]).toBe("video/quicktime");
      expect(params.slice(10)).toEqual(["ws/media/a1/IMG_0001.MOV", "IMG_0001.MOV", 10]);
      expect(deleted).toEqual([]);
    });

    it("drop their MP4 copy when another worker took the job over", async () => {
      const { deps, deleted } = fakeDeps(job(1), async () => mov, { fileName: "IMG_0001.MOV", lostJob: true });
      deps.remux = async () => ({ key: "ws/media/a1/IMG_0001.mp4", fileName: "IMG_0001.mp4", sizeBytes: 9 });
      await runNextJob(deps);
      expect(deleted).toEqual(["ws/media/a1/IMG_0001.mp4"]);
    });

    it("MP4 uploads are not touched", async () => {
      const { deps } = fakeDeps(job(1), async () => ({ ...mov, mimeType: "video/mp4" }));
      let asked = false;
      deps.remux = async () => {
        asked = true;
        return null;
      };
      await runNextJob(deps);
      expect(asked).toBe(false);
    });
  });
});
