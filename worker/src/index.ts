// Post Social worker: background media jobs and storage sweeps. Runs as a container on
// InsForge Compute; settings come from environment variables.
import { createServer } from "node:http";
import { createSql } from "../../backend/lib/insforge-admin";
import { createR2 } from "../../backend/lib/media/r2";
import { expireUnusedMedia, removeExpiredSignIns, removeOrphanedFiles } from "./cleanup";
import { runNextJob, type WorkerDeps } from "./jobs";
import { probeStoredFile } from "./probe";
import { safeFetch } from "./safe-fetch";
import { refreshDueTokens } from "./tokens";
import { makePosters } from "./posters";
import { runNextPublishJob } from "./publish/runner";
import { runMetricsSweep } from "./analytics/runner";
import { PLATFORMS, type Platform } from "../../backend/lib/connections/platforms";
import { createTelemetry } from "../../backend/lib/telemetry";

function setting(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function log(message: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...details }));
}

// Errors and post outcomes go to PostHog when POSTHOG_KEY is set.
const telemetry = createTelemetry({ key: process.env.POSTHOG_KEY, host: process.env.POSTHOG_HOST, service: "worker", environment: process.env.APP_ENV ?? "dev" });

const sql = createSql(setting("INSFORGE_BASE_URL"), setting("INSFORGE_API_KEY"));
const r2 = createR2({
  accountId: setting("R2_ACCOUNT_ID"),
  bucket: setting("R2_BUCKET"),
  accessKeyId: setting("R2_ACCESS_KEY_ID"),
  secretAccessKey: setting("R2_SECRET_ACCESS_KEY"),
});
const deps: WorkerDeps = {
  sql,
  r2,
  probe: (key, size, expected) => probeStoredFile(r2, key, size, expected),
  download: (url, signal) => safeFetch(url, { signal }),
  log,
};

const retentionDays = Number(setting("MEDIA_RETENTION_DAYS", "30"));
const concurrency = Number(setting("WORKER_CONCURRENCY", "3"));
let stopping = false;
let lastLoopAt = Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const allowlist = (process.env.PUBLISH_ALLOWLIST ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const publishDeps = { sql, r2, setting: (name: string) => setting(name), allowlist, log, telemetry };

async function jobLoop(slot: number) {
  while (!stopping) {
    lastLoopAt = Date.now();
    try {
      // Publishing first: scheduled posts must go out on time.
      const published = await runNextPublishJob(publishDeps);
      const processed = published ? false : await runNextJob(deps);
      if (!published && !processed) await sleep(2000);
    } catch (error) {
      log("job loop error", { slot, error: (error as Error).message });
      void telemetry.captureException(error, { area: "job loop", slot });
      await sleep(5000);
    }
  }
}

async function every(ms: number, name: string, task: () => Promise<number>) {
  while (!stopping) {
    try {
      const count = await task();
      if (count) log(`${name} done`, { count });
    } catch (error) {
      log(`${name} error`, { error: (error as Error).message });
      void telemetry.captureException(error, { area: name });
    }
    await sleep(ms);
  }
}

process.on("unhandledRejection", (reason) => {
  log("unhandled rejection", { error: String(reason) });
  void telemetry.captureException(reason, { area: "unhandled rejection" });
});

// Health check for the platform and the uptime monitor: unhealthy if the job loop has
// stalled. A long upload can hold one slot for minutes, never all of them for 15.
createServer((_request, response) => {
  const healthy = Date.now() - lastLoopAt < 15 * 60 * 1000;
  response.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: healthy }));
}).listen(Number(process.env.PORT ?? 8080));

process.on("SIGTERM", () => {
  stopping = true;
  log("stopping");
  setTimeout(() => process.exit(0), 10_000).unref();
});

log("worker started", { concurrency, retentionDays, publishAllowlist: allowlist.length });
for (let slot = 0; slot < concurrency; slot++) void jobLoop(slot);
void every(60 * 60 * 1000, "retention sweep", () => expireUnusedMedia(sql, r2, retentionDays));
void every(6 * 60 * 60 * 1000, "orphan sweep", () => removeOrphanedFiles(sql, r2));
void every(60 * 60 * 1000, "sign-in sweep", () => removeExpiredSignIns(sql));
void every(60 * 1000, "poster sweep", () => makePosters(sql, r2));
// Post stats, only for platforms switched on here (ANALYTICS_PLATFORMS, e.g. "instagram,threads").
const analyticsPlatforms = (process.env.ANALYTICS_PLATFORMS ?? "").split(",").map((p) => p.trim()).filter((p): p is Platform => PLATFORMS.includes(p as Platform));
if (analyticsPlatforms.length) void every(2 * 60 * 1000, "stats sweep", () => runMetricsSweep({ sql, setting: (name) => setting(name), platforms: analyticsPlatforms, log }));
void every(5 * 60 * 1000, "token refresh", () => refreshDueTokens({ sql, setting: (name) => setting(name) }));
