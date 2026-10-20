// Post Social worker: background media jobs and storage sweeps. Runs as a container on
// InsForge Compute; settings come from environment variables.
import { createServer } from "node:http";
import { createSql } from "../../backend/lib/insforge-admin";
import { createR2 } from "../../backend/lib/media/r2";
import { expireUnusedMedia, removeExpiredSignIns, removeOrphanedFiles } from "./cleanup";
import { runNextJob, type WorkerDeps } from "./jobs";
import { probeStoredFile } from "./probe";
import { remuxToMp4 } from "./remux";
import { safeFetch } from "./safe-fetch";
import { refreshDueTokens } from "./tokens";
import { makePosters } from "./posters";
import { syncAvatars } from "./avatars";
import { runNextPublishJob } from "./publish/runner";
import { runFollowerSweep } from "./analytics/followers";
import { runMetricsSweep } from "./analytics/runner";
import { runStatsHealthCheck } from "./analytics/health";
import { createAdminAlert } from "./alerts";
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
  remux: (key, fileName, videoFormat) => remuxToMp4({ r2, log }, key, fileName, videoFormat),
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
void every(2 * 60 * 1000, "profile picture sweep", () => syncAvatars({ sql, r2, setting: (name) => setting(name), download: deps.download, log }));
// Post stats, only for platforms switched on here: through the platform's own API
// (ANALYTICS_PLATFORMS, e.g. "instagram,threads") and from public pages through
// ScrapeCreators (ANALYTICS_PUBLIC_PLATFORMS, needs SCRAPECREATORS_API_KEY).
const platformList = (raw: string | undefined) => (raw ?? "").split(",").map((p) => p.trim()).filter((p): p is Platform => PLATFORMS.includes(p as Platform));
const analyticsPlatforms = platformList(process.env.ANALYTICS_PLATFORMS);
const publicPlatforms = platformList(process.env.ANALYTICS_PUBLIC_PLATFORMS);
const publicApiKey = process.env.SCRAPECREATORS_API_KEY || null;
// Said at every start, so a deploy that lost these settings shows up in the logs.
log("analytics", { official: analyticsPlatforms, public: publicApiKey ? publicPlatforms : [], publicKey: Boolean(publicApiKey) });
if (analyticsPlatforms.length || (publicApiKey && publicPlatforms.length)) {
  void every(2 * 60 * 1000, "stats sweep", () => runMetricsSweep({ sql, setting: (name) => setting(name), platforms: analyticsPlatforms, publicPlatforms, publicApiKey, log }));
  void every(10 * 60 * 1000, "follower sweep", () => runFollowerSweep({ sql, platforms: analyticsPlatforms, publicPlatforms, publicApiKey, log }));
}
// Daily stats health check for every switched-on platform, alerting only the admin
// (ALERT_EMAIL, plus PostHog). First run 10 minutes after start, so a deploy is checked.
if (analyticsPlatforms.length || publicPlatforms.length) {
  const alert = createAdminAlert({ to: process.env.ALERT_EMAIL || null, resendKey: process.env.RESEND_API_KEY || null, environment: process.env.APP_ENV ?? "dev", telemetry, log });
  const check = async () => {
    const result = await runStatsHealthCheck({
      sql, platforms: analyticsPlatforms, publicPlatforms, publicApiKey, alert,
      creditsWarnBelow: Number(process.env.ALERT_CREDITS_BELOW ?? 1000),
      record: (properties) => telemetry.capture("stats health check", properties),
    });
    log("stats health check", { problems: result.problems.length, creditsLeft: result.creditsLeft });
    return 0;
  };
  setTimeout(() => void every(24 * 60 * 60 * 1000, "stats health check", check), 10 * 60 * 1000).unref();
}
void every(5 * 60 * 1000, "token refresh", () => refreshDueTokens({ sql, setting: (name) => setting(name) }));
