// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Sql } from "./access";
import { recordWorkerBeat, secondsSinceWorkerBeat, workerStatus, WORKER_SILENCE_LIMIT_SECONDS } from "./worker-heartbeat";

describe("the worker's heartbeat", () => {
  it("keeps one row and moves its time forward", async () => {
    const sql = vi.fn(async () => []) as unknown as Sql;
    await recordWorkerBeat(sql);
    const [query, params] = vi.mocked(sql).mock.calls[0];
    expect(query).toContain("INSERT INTO public.worker_heartbeat");
    expect(query).toContain("ON CONFLICT (id) DO UPDATE SET beat_at = now()");
    expect(params).toEqual([]);
  });

  it("reads the silence in seconds, and null when the worker has never beaten", async () => {
    expect(await secondsSinceWorkerBeat((async () => [{ seconds: 12.4 }]) as unknown as Sql)).toBe(12.4);
    expect(await secondsSinceWorkerBeat((async () => [{ seconds: "41.5" }]) as unknown as Sql)).toBe(41.5);
    expect(await secondsSinceWorkerBeat((async () => []) as unknown as Sql)).toBeNull();
  });

  it("counts the worker as up only while its last beat is recent", () => {
    expect(workerStatus(12.4)).toEqual({ ok: true, seconds: 12 });
    expect(workerStatus(WORKER_SILENCE_LIMIT_SECONDS - 1)).toEqual({ ok: true, seconds: WORKER_SILENCE_LIMIT_SECONDS - 1 });
    expect(workerStatus(WORKER_SILENCE_LIMIT_SECONDS)).toEqual({ ok: false, seconds: WORKER_SILENCE_LIMIT_SECONDS });
    expect(workerStatus(86_400)).toEqual({ ok: false, seconds: 86_400 });
    expect(workerStatus(null)).toEqual({ ok: false, seconds: null });
    expect(workerStatus(Number.NaN)).toEqual({ ok: false, seconds: null });
    // Never a negative silence.
    expect(workerStatus(-0.2)).toEqual({ ok: true, seconds: 0 });
  });
});
