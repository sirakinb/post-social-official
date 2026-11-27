// The worker's heartbeat. On AWS nothing can call the worker, so it writes the time of its
// last sign of life to the database and the API reports it at /readyz/worker, which the
// uptime check reads (.github/workflows/uptime.yml).
import type { Sql } from "./access";

// How often the worker beats while its job loop is alive.
export const WORKER_BEAT_EVERY_MS = 30_000;
// How long without a beat before the worker counts as down. A release stops the old worker
// before it starts the new one, which takes a minute or two; this leaves room for that.
export const WORKER_SILENCE_LIMIT_SECONDS = 5 * 60;

export async function recordWorkerBeat(sql: Sql): Promise<void> {
  await sql(
    `INSERT INTO public.worker_heartbeat (id, beat_at) VALUES (true, now())
     ON CONFLICT (id) DO UPDATE SET beat_at = now()`,
    [],
  );
}

// Seconds since the worker's last beat, by the database's clock (the worker and the API run
// on different machines). Null when it has never beaten.
export async function secondsSinceWorkerBeat(sql: Sql): Promise<number | null> {
  const [row] = await sql<{ seconds: number | string }>(
    `SELECT extract(epoch FROM now() - beat_at)::float8 AS seconds FROM public.worker_heartbeat`,
    [],
  );
  return row ? Number(row.seconds) : null;
}

// What /readyz/worker answers for a given silence.
export function workerStatus(seconds: number | null): { ok: boolean; seconds: number | null } {
  if (seconds === null || !Number.isFinite(seconds)) return { ok: false, seconds: null };
  return { ok: seconds < WORKER_SILENCE_LIMIT_SECONDS, seconds: Math.max(0, Math.round(seconds)) };
}
