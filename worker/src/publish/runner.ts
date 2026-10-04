// Claims due publish jobs and runs one step of the right platform adapter. Every write is
// fenced on the claim (attempt and poll counts), so a worker whose lease expired cannot
// overwrite a newer run.
import type { Sql } from "../../../backend/lib/access";
import { importKey, open, seal } from "../../../backend/lib/connections/crypto";
import { refreshTokens, type Platform, type Settings } from "../../../backend/lib/connections/platforms";
import type { R2 } from "../../../backend/lib/media/r2";
import { destinationProblems, type DestinationOptions } from "../../../backend/lib/publishing/validate";
import { publishFacebook } from "./facebook";
import { publishInstagram, publishThreads } from "./meta";
import { publishTikTok } from "./tiktok";
import { PublishError, type Adapter, type Bundle, type Checkpoint, type StepContext, type StepResult } from "./types";
import { publishYouTube } from "./youtube";

export const ADAPTERS: Record<Platform, Adapter> = {
  instagram: publishInstagram,
  facebook: publishFacebook,
  threads: publishThreads,
  youtube: publishYouTube,
  tiktok: publishTikTok,
};

export type PublishDeps = {
  sql: Sql;
  r2: R2;
  setting: Settings;
  http?: typeof fetch;
  adapters?: Partial<Record<Platform, Adapter>>;
  // Dev safety: only these platform account ids may be published to (empty = no limit).
  allowlist?: string[];
  // Claim only this workspace's jobs (tests, manual draining). Default: every unpaused workspace.
  onlyWorkspace?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

type Job = { id: string; workspace_id: string; post_id: string; destination_id: string; attempt_count: number; poll_count: number; max_attempts: number; checkpoint: Checkpoint; started_at: string };

const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000];
const MAX_POLL_MINUTES = 30;
const LEASE_SECONDS = 600;

export async function runNextPublishJob(deps: PublishDeps): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const [job] = await deps.sql<Job>(`SELECT * FROM public.claim_publish_job($1, $2)`, [LEASE_SECONDS, deps.onlyWorkspace ?? null]);
  if (!job) return false;
  const fence = `id = $1 AND attempt_count = ${Number(job.attempt_count)} AND poll_count = ${Number(job.poll_count)} AND state = 'running'`;

  const finish = async (state: "complete" | "failed" | "cancelled", error: string | null) =>
    deps.sql(`UPDATE public.publish_jobs SET state = $2, last_error = $3, lease_expires_at = NULL, finished_at = now() WHERE ${fence}`, [job.id, state, error]);

  let bundle: Bundle | null = null;
  try {
    bundle = await loadBundle(deps, job);
    if (!bundle) {
      await finish("cancelled", "The post or destination was cancelled.");
      return true;
    }
    const b = bundle;
    if (deps.allowlist?.length && !deps.allowlist.includes(b.account.externalId)) {
      throw new PublishError("not_allowlisted", `This environment only publishes to approved test accounts; ${b.account.displayName} is not one of them.`);
    }

    // The same checks as at submit time, unless the post is already part-way through.
    if (!Object.keys(job.checkpoint ?? {}).length) {
      const problems = destinationProblems({ options: b.options, caption: b.caption, media: b.media, capabilities: b.account.capabilities as { video_max_seconds?: number } });
      if (problems.length) throw new PublishError("invalid", problems.join(" "));
    }

    await deps.sql(
      `WITH p AS (SELECT public.mark_post_sending($2))
       UPDATE public.destinations SET status = 'processing' WHERE id = $1 AND status IN ('queued', 'scheduled')`,
      [b.destinationId, b.postId],
    );

    const checkpoint: Checkpoint = { ...(job.checkpoint ?? {}) };
    const ctx: StepContext = {
      bundle: b,
      checkpoint,
      http: deps.http ?? fetch,
      now,
      sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      save: async (patch) => {
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) delete checkpoint[key];
          else checkpoint[key] = value;
        }
        const saved = await deps.sql(`UPDATE public.publish_jobs SET checkpoint = jsonb_strip_nulls(checkpoint || $2::jsonb) WHERE ${fence} RETURNING id`, [job.id, JSON.stringify(patch)]);
        if (!saved.length) throw new PublishError("lost_job", "Another worker took over this job.", true);
      },
      renewLease: async () => {
        await deps.sql(`UPDATE public.publish_jobs SET lease_expires_at = now() + make_interval(secs => $2) WHERE ${fence}`, [job.id, LEASE_SECONDS]);
      },
      reserve: async (operation, limit, windowSeconds) => {
        const [{ reserve_platform_call: retryAt }] = await deps.sql<{ reserve_platform_call: string | null }>(
          `SELECT public.reserve_platform_call($1, $2, $3, $4)`,
          [b.account.id, operation, limit, windowSeconds],
        );
        if (retryAt) throw new PublishError("rate_limited", "This account reached its safe posting limit for now; it will go out when the limit resets.", true, new Date(retryAt));
      },
      token: () => accessToken(deps, b, now),
    };

    const adapter = deps.adapters?.[b.platform] ?? ADAPTERS[b.platform];
    const result: StepResult = await adapter(ctx);

    if (result.kind === "wait") {
      const minutes = (now() - Date.parse(job.started_at)) / 60_000;
      if (minutes > MAX_POLL_MINUTES) {
        throw new PublishError("unconfirmed", `${result.message ?? "The platform has not confirmed the post"} after ${MAX_POLL_MINUTES} minutes. Check the platform before posting again.`);
      }
      await deps.sql(
        `UPDATE public.publish_jobs SET state = 'polling', poll_count = poll_count + 1, lease_expires_at = NULL,
           next_attempt_at = now() + make_interval(secs => $2), last_error = $3 WHERE ${fence}`,
        [job.id, Math.max(1, Math.round(result.afterMs / 1000)), result.message ?? null],
      );
      return true;
    }

    await deps.sql(
      `WITH d AS (
         UPDATE public.destinations SET status = 'published', live_url = $2, platform_request_id = $3, error_code = NULL, error_message = $4
         WHERE id = $1 RETURNING workspace_id
       ), usage AS (
         INSERT INTO public.usage_events (workspace_id, event_type, quantity) SELECT workspace_id, 'post_published', 1 FROM d
       )
       INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       SELECT workspace_id, 'worker', 'destination.published', 'destination', $1, $5, jsonb_build_object('live_url', $2::text) FROM d`,
      [b.destinationId, result.liveUrl ?? null, result.platformId ?? null, result.note ?? null, `Published to ${b.account.displayName}`],
    );
    await finish("complete", null);
    await deps.sql(`SELECT public.finalize_post($1)`, [b.postId]);
    log("published", { job: job.id, platform: b.platform });
    return true;
  } catch (cause) {
    const error = cause instanceof PublishError ? cause : new PublishError("unexpected", cause instanceof Error ? cause.message : String(cause), true);
    if (error.code === "lost_job") return true;
    log("publish error", { job: job.id, code: error.code, message: error.message, retryable: error.retryable });

    if (error.reconnect && bundle) {
      await deps.sql(
        `UPDATE public.connected_accounts SET health = 'needs_attention', health_reason = $2 WHERE id = $1 AND health = 'connected'`,
        [bundle.account.id, "Access expired. Reconnect this account to keep posting."],
      );
    }

    if (error.retryable && job.attempt_count < job.max_attempts) {
      const at = error.retryAt ?? new Date(now() + BACKOFF_MS[Math.min(job.attempt_count - 1, BACKOFF_MS.length - 1)]);
      await deps.sql(
        `UPDATE public.publish_jobs SET state = 'retry_wait', next_attempt_at = $2, lease_expires_at = NULL, last_error = $3 WHERE ${fence}`,
        [job.id, at.toISOString(), error.message.slice(0, 500)],
      );
      return true;
    }

    await finish("failed", error.message.slice(0, 500));
    await deps.sql(
      `WITH d AS (
         UPDATE public.destinations SET status = 'failed', error_code = $2, error_message = $3 WHERE id = $1 AND status <> 'published' RETURNING workspace_id
       )
       INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       SELECT workspace_id, 'worker', 'destination.failed', 'destination', $1, $4, jsonb_build_object('code', $2::text, 'message', $3::text) FROM d`,
      [job.destination_id, error.code, error.message.slice(0, 500), `Could not publish${bundle ? ` to ${bundle.account.displayName}` : ""}`],
    );
    await deps.sql(`SELECT public.finalize_post($1)`, [job.post_id]);
    return true;
  }
}

async function loadBundle(deps: PublishDeps, job: Job): Promise<Bundle | null> {
  const [row] = await deps.sql<{
    status: string; post_status: string; platform: Platform; options: DestinationOptions; caption: string;
    account_id: string; external_account_id: string; handle: string; display_name: string; scopes: string[]; capabilities: Record<string, unknown>; health: string;
  }>(
    `SELECT d.status, p.status AS post_status, d.platform, d.options, p.caption,
            a.id AS account_id, a.external_account_id, a.handle, a.display_name, a.scopes, a.capabilities, a.health
     FROM public.destinations d JOIN public.posts p ON p.id = d.post_id JOIN public.connected_accounts a ON a.id = d.connected_account_id
     WHERE d.id = $1`,
    [job.destination_id],
  );
  if (!row || row.status === "cancelled" || row.post_status === "cancelled") return null;
  if (row.health === "disconnected") throw new PublishError("account_disconnected", `${row.display_name} was disconnected. Reconnect it to publish.`);

  const media = await deps.sql<{ id: string; name: string; status: string; media_type: "image" | "video"; mime_type: string; size_bytes: string; width: number | null; height: number | null; duration_seconds: number | null; storage_key: string }>(
    `SELECT m.id, coalesce(m.display_name, m.file_name) AS name, m.status, m.media_type, m.mime_type, m.size_bytes, m.width, m.height,
            m.duration_seconds::float8 AS duration_seconds, m.storage_key
     FROM public.post_media pm JOIN public.media_assets m ON m.id = pm.media_asset_id WHERE pm.post_id = $1 ORDER BY pm.position`,
    [job.post_id],
  );
  // Platforms fetch media by URL; signed links stay valid long enough for slow processing.
  const withUrls = await Promise.all(media.map(async (m) => ({ ...m, size_bytes: Number(m.size_bytes), url: await deps.r2.presignGet(m.storage_key, 12 * 3600) })));
  return {
    jobId: job.id,
    workspaceId: job.workspace_id,
    postId: job.post_id,
    destinationId: job.destination_id,
    platform: row.platform,
    options: row.options,
    caption: row.caption,
    account: { id: row.account_id, externalId: row.external_account_id, handle: row.handle, displayName: row.display_name, scopes: row.scopes ?? [], capabilities: row.capabilities ?? {} },
    media: withUrls,
  };
}

// Decrypts the account's token, refreshing it first if it expires within five minutes.
async function accessToken(deps: PublishDeps, bundle: Bundle, now: () => number) {
  const [credential] = await deps.sql<{ id: string; encrypted_payload: string; initialization_vector: string; access_token_expires_at: string | null }>(
    `SELECT id, encrypted_payload, initialization_vector, access_token_expires_at FROM public.credentials WHERE connected_account_id = $1`,
    [bundle.account.id],
  );
  if (!credential) throw new PublishError("credential_missing", `${bundle.account.displayName} has no saved access. Reconnect it.`, false, undefined, true);
  const key = await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY"));
  const tokens = await open({ encryptedPayload: credential.encrypted_payload, initializationVector: credential.initialization_vector }, key);
  const expires = credential.access_token_expires_at ? Date.parse(credential.access_token_expires_at) : Infinity;
  if (expires - now() > 5 * 60_000) return tokens.accessToken;

  const refreshed = await refreshTokens(bundle.platform, tokens, deps.setting, deps.http).catch((error) => {
    throw new PublishError("access_expired", `${bundle.account.displayName}'s access expired and could not be renewed (${error instanceof Error ? error.message : "unknown"}). Reconnect it.`, false, undefined, true);
  });
  if (!refreshed) return tokens.accessToken;
  const sealed = await seal(refreshed.tokens, key);
  await deps.sql(
    `UPDATE public.credentials SET encrypted_payload = $2, initialization_vector = $3, access_token_expires_at = $4,
       refresh_token_expires_at = coalesce($5, refresh_token_expires_at) WHERE id = $1`,
    [credential.id, sealed.encryptedPayload, sealed.initializationVector, refreshed.accessTokenExpiresAt?.toISOString() ?? null, refreshed.refreshTokenExpiresAt?.toISOString() ?? null],
  );
  return refreshed.tokens.accessToken;
}
