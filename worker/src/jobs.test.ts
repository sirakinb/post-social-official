// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runNextJob, type WorkerDeps } from "./jobs";

type Call = { query: string; params: unknown[] };

// A fake database: hands out one claimed job and records every statement.
function fakeDeps(job: Record<string, unknown>, probe: WorkerDeps["probe"]) {
  const calls: Call[] = [];
  const asset = { id: "a1", storage_key: "k", size_bytes: 10, media_type: "video", mime_type: "video/mp4", source_url: null, file_name: "clip.mp4" };
  const sql = (async (query: string, params: unknown[] = []) => {
    calls.push({ query, params });
    if (query.includes("claim_media_job")) return [job];
    if (query.includes("FROM public.media_assets")) return [asset];
    if (query.includes("AS owns")) return [{ owns: true }];
    return [];
  }) as WorkerDeps["sql"];
  const deps: WorkerDeps = {
    sql,
    r2: { head: async () => ({ sizeBytes: 10 }), delete: async () => undefined } as unknown as WorkerDeps["r2"],
    probe,
    download: async () => {
      throw new Error("not used");
    },
    log: () => undefined,
  };
  return { deps, calls };
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
    expect(calls.some((c) => c.query.includes("SET status = 'failed'") && c.params.includes("Processing kept failing. Try uploading the file again."))).toBe(true);
    expect(calls.some((c) => c.query.includes("UPDATE public.media_jobs") && c.params[1] === "failed")).toBe(true);
  });
});
