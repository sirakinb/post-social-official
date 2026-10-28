// Posts: drafts, checks, submitting, approvals, scheduling and cancelling. The same
// actions back the web app, the REST API and the MCP tools (Phase 5). Every change checks
// membership and writes an audit entry naming the actor.
import { ApiError, isAgentCaller, membership, requireUuid, type Caller, type Sql } from "../access";
import { reportError, trackEvent, tracking } from "../telemetry";
import { publicHandle, withHandle } from "../connections/handles";
import { DISPLAY_NAMES, type Platform } from "../connections/platforms";
import { firstPublishedAt, publishedAtSql } from "./published";
import { captionFor, destinationProblems, normalizeOptions, type DestinationOptions, type MediaFacts } from "./validate";

export type PostsDeps = { sql: Sql };

type Policy = "confirm_each" | "approve_after_draft" | "autonomous";

const MAX_CAPTION = 10_000;
const MAX_DESTINATIONS = 20;
const MAX_MEDIA = 35;
const EDITABLE = ["draft", "awaiting_approval", "approved", "scheduled"];

// People direct their AI, so AI posts go out as directed; they wait only on an account a
// person has set to ask first (none by default). Posts made in the web app are already
// the person's decision.
export function needsApproval(entryPoint: Caller["entryPoint"], policy: Policy, _platform: Platform) {
  if (entryPoint === "ui") return false;
  return policy !== "autonomous";
}

// Test keys can do everything except send or schedule a post.
function assertMayPublish(caller: Caller) {
  if (isAgentCaller(caller) && caller.mode === "test") {
    throw new ApiError(403, "Test keys cannot publish or schedule. The post stays a draft; use a live key to send it.");
  }
}

// Approving is the person's decision. (Phase 5C rules may let an AI approve for some accounts.)
function assertPerson(caller: Caller, action: string) {
  if (caller.entryPoint !== "ui") {
    throw new ApiError(403, `Only a person can ${action} posts. They can do it in Post Social under Approvals.`);
  }
}

type AccountRow = { id: string; platform: Platform; display_name: string; handle: string; health: string; capabilities: Record<string, unknown>; policy: Policy; tiktok_delivery: "direct" | "inbox" };
type DestinationInput = { account_id: string; options: DestinationOptions };

async function loadAccounts(deps: PostsDeps, workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, AccountRow>();
  const rows = await deps.sql<AccountRow>(
    `SELECT a.id, a.platform, a.display_name, a.handle, a.health, a.capabilities,
            coalesce(a.approval_policy_override, w.default_approval_policy) AS policy, a.tiktok_delivery
     FROM public.connected_accounts a JOIN public.workspaces w ON w.id = a.workspace_id
     WHERE a.workspace_id = $1 AND a.id = ANY($2::uuid[])`,
    [workspaceId, ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function loadMedia(deps: PostsDeps, workspaceId: string, ids: string[]): Promise<MediaFacts[]> {
  if (!ids.length) return [];
  const rows = await deps.sql<MediaFacts & { display_name: string | null; file_name: string }>(
    `SELECT id, coalesce(display_name, file_name) AS name, status, media_type, mime_type, size_bytes::bigint AS size_bytes,
            width, height, duration_seconds::float8 AS duration_seconds
     FROM public.media_assets WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [workspaceId, ids],
  );
  const byId = new Map(rows.map((r) => [r.id, { ...r, size_bytes: Number(r.size_bytes) }]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new ApiError(400, `${missing.length === 1 ? "A media item was" : `${missing.length} media items were`} not found in this workspace.`);
  return ids.map((id) => byId.get(id)!);
}

// The library images chosen as covers, by id. Throws if one isn't in this workspace.
async function loadCovers(deps: PostsDeps, workspaceId: string, destinations: Array<{ options: DestinationOptions }>): Promise<Map<string, MediaFacts>> {
  const ids = [...new Set(destinations.map((d) => d.options.cover_media_id).filter((id): id is string => Boolean(id)))];
  const facts = await loadMedia(deps, workspaceId, ids);
  return new Map(facts.map((f) => [f.id, f]));
}

// Each TikTok account says how an AI's posts reach it: directly (the default) or through the
// creator's TikTok inbox. An AI that leaves delivery_mode out gets the account's choice, and
// can't post directly to an account set to inbox first. People choose per post in Create.
function tiktokInboxFirst(caller: Caller, account: AccountRow, options: DestinationOptions) {
  return caller.entryPoint !== "ui" && account.platform === "tiktok" && account.tiktok_delivery === "inbox" && (options as { delivery_mode?: string }).delivery_mode !== "inbox";
}
const inboxFirst = (account: AccountRow) =>
  `${account.display_name} is set to send AI posts to the TikTok inbox first: use delivery_mode "inbox", or change the account's TikTok delivery to direct (set_tiktok_delivery, or Accounts in Post Social).`;

function parseDestinations(caller: Caller, raw: unknown, accounts: Map<string, AccountRow>): { destinations: DestinationInput[]; problems: string[] } {
  if (!Array.isArray(raw) || raw.length === 0) throw new ApiError(400, "Choose at least one account to post to.");
  if (raw.length > MAX_DESTINATIONS) throw new ApiError(400, `A post can go to at most ${MAX_DESTINATIONS} accounts.`);
  const problems: string[] = [];
  const destinations: DestinationInput[] = [];
  const seen = new Set<string>();
  for (const item of raw as Array<Record<string, unknown>>) {
    const accountId = requireUuid(item?.account_id, "Account");
    const account = accounts.get(accountId);
    if (!account) throw new ApiError(400, "One of the chosen accounts is not connected to this workspace.");
    if (seen.has(accountId)) throw new ApiError(400, `${account.display_name} is listed twice.`);
    seen.add(accountId);
    if (account.health === "disconnected") problems.push(`${account.display_name} is disconnected. Reconnect it first.`);
    const given = item.options ?? {};
    const fillDelivery = account.platform === "tiktok" && caller.entryPoint !== "ui" && typeof given === "object" && !Array.isArray(given) && (given as Record<string, unknown>).delivery_mode === undefined;
    const options = fillDelivery ? { ...(given as Record<string, unknown>), delivery_mode: account.tiktok_delivery } : item.options;
    const normalized = normalizeOptions(account.platform, options);
    if (normalized.options && tiktokInboxFirst(caller, account, normalized.options)) problems.push(inboxFirst(account));
    problems.push(...normalized.problems.map((p) => `${account.display_name}: ${p}`));
    if (normalized.options) destinations.push({ account_id: accountId, options: normalized.options });
  }
  return { destinations, problems };
}

function parseSchedule(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime())) throw new ApiError(400, "The scheduled time is not a valid date. Use ISO 8601, e.g. 2026-10-05T15:00:00Z.");
  if (at.getTime() < Date.now() - 60_000) throw new ApiError(400, "The scheduled time is in the past.");
  if (at.getTime() > Date.now() + 365 * 24 * 3600_000) throw new ApiError(400, "Posts can be scheduled up to a year ahead.");
  return at.toISOString();
}

function parseCaption(value: unknown) {
  const caption = typeof value === "string" ? value : "";
  if (caption.length > MAX_CAPTION) throw new ApiError(400, `Captions can be at most ${MAX_CAPTION.toLocaleString("en-US")} characters.`);
  return caption;
}

function parseMediaIds(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiError(400, "media_ids must be a list.");
  if (value.length > MAX_MEDIA) throw new ApiError(400, `A post can include at most ${MAX_MEDIA} media files.`);
  const ids = value.map((id) => requireUuid(id, "Media"));
  if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) throw new ApiError(400, "Each media item can be used only once in a post.");
  return ids;
}

export type CheckResult = { ok: boolean; problems: string[]; destinations: Array<{ account_id: string; account: string; account_handle: string | null; platform: Platform; problems: string[] }> };

function check(caption: string, media: MediaFacts[], destinations: DestinationInput[], accounts: Map<string, AccountRow>, shapeProblems: string[], covers: Map<string, MediaFacts>): CheckResult {
  const per = destinations.map((d) => {
    const account = accounts.get(d.account_id)!;
    return {
      account_id: d.account_id,
      account: account.display_name,
      account_handle: publicHandle(account.platform, account.handle),
      platform: account.platform,
      problems: destinationProblems({ options: d.options, caption, media, capabilities: account.capabilities as { video_max_seconds?: number }, cover: d.options.cover_media_id ? covers.get(d.options.cover_media_id) : undefined }).map(
        (p) => `${DISPLAY_NAMES[account.platform]} (${account.display_name}): ${p}`,
      ),
    };
  });
  const all = [...shapeProblems, ...per.flatMap((d) => d.problems)];
  return { ok: all.length === 0, problems: all, destinations: per };
}

// ----- reading a saved post -----

type PostRow = { id: string; workspace_id: string; status: string; caption: string; scheduled_at: string | null; entry_point: string; actor_id: string | null; created_at: string; updated_at: string };

async function loadPost(deps: PostsDeps, caller: Caller, postId: string, write: boolean) {
  const [post] = await deps.sql<PostRow>(`SELECT * FROM public.posts WHERE id = $1`, [postId]);
  if (!post) throw new ApiError(404, "That post was not found.");
  const member = await membership(deps.sql, caller, post.workspace_id, write, "Reviewers can view posts but not change them.").catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That post was not found.");
    throw error;
  });
  const mediaIds = (await deps.sql<{ media_asset_id: string }>(`SELECT media_asset_id FROM public.post_media WHERE post_id = $1 ORDER BY position`, [postId])).map((r) => r.media_asset_id);
  const destinations = await deps.sql<{ id: string; connected_account_id: string; platform: Platform; status: string; options: DestinationOptions; live_url: string | null; error_code: string | null; error_message: string | null }>(
    `SELECT id, connected_account_id, platform, status, options, live_url, error_code, error_message FROM public.destinations WHERE post_id = $1 ORDER BY created_at`,
    [postId],
  );
  return { post, member, mediaIds, destinations };
}

async function view(deps: PostsDeps, postId: string) {
  const [post] = await deps.sql<PostRow>(`SELECT * FROM public.posts WHERE id = $1`, [postId]);
  const destinations = await deps.sql<Record<string, unknown>>(
    `SELECT d.id, d.connected_account_id AS account_id, a.display_name AS account, a.handle AS account_handle, d.platform, d.status, d.options,
            d.live_url, ${publishedAtSql("d")} AS published_at, d.error_code, d.error_message
     FROM public.destinations d JOIN public.connected_accounts a ON a.id = d.connected_account_id
     WHERE d.post_id = $1 ORDER BY d.created_at`,
    [postId],
  );
  const media = await deps.sql<{ media_asset_id: string }>(`SELECT media_asset_id FROM public.post_media WHERE post_id = $1 ORDER BY position`, [postId]);
  const [approval] = await deps.sql<{ id: string; status: string; requested_at: string }>(
    `SELECT id, status, requested_at FROM public.approval_requests WHERE post_id = $1 ORDER BY requested_at DESC LIMIT 1`,
    [postId],
  );
  return {
    id: post.id,
    workspace_id: post.workspace_id,
    status: post.status,
    caption: post.caption,
    scheduled_at: post.scheduled_at,
    // When it first went out: the earliest destination's publish time (null until one is live).
    published_at: firstPublishedAt(destinations as { published_at?: unknown }[]),
    media_ids: media.map((m) => m.media_asset_id),
    destinations: destinations.map(withHandle),
    approval: approval ?? null,
    created_at: post.created_at,
    updated_at: post.updated_at,
  };
}

async function audit(deps: PostsDeps, workspaceId: string, actorId: string, caller: Caller, postId: string, eventType: string, summary: string, before?: unknown, after?: unknown) {
  await deps.sql(
    `INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, before_values, after_values)
     VALUES ($1, $2, $3, $4, 'post', $5, $6, $7::jsonb, $8::jsonb)`,
    [workspaceId, actorId, caller.entryPoint, eventType, postId, summary, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after)],
  );
}

// ----- actions -----

// Checks a post without saving anything: a saved post (post_id) or a proposed one.
export async function validatePost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>): Promise<CheckResult> {
  if (input.post_id !== undefined) {
    const { post, mediaIds, destinations } = await loadPost(deps, caller, requireUuid(input.post_id, "Post"), false);
    const accounts = await loadAccounts(deps, post.workspace_id, destinations.map((d) => d.connected_account_id));
    const media = await loadMedia(deps, post.workspace_id, mediaIds);
    const list = destinations.map((d) => ({ account_id: d.connected_account_id, options: d.options }));
    return check(post.caption, media, list, accounts, [], await loadCovers(deps, post.workspace_id, list));
  }
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(deps.sql, caller, workspaceId, false);
  const caption = parseCaption(input.caption);
  const raw = Array.isArray(input.destinations) ? (input.destinations as Array<Record<string, unknown>>) : [];
  const accounts = await loadAccounts(deps, workspaceId, raw.map((d) => String(d?.account_id ?? "")).filter((id) => /^[0-9a-f-]{36}$/i.test(id)));
  const { destinations, problems } = parseDestinations(caller, input.destinations, accounts);
  const media = await loadMedia(deps, workspaceId, parseMediaIds(input.media_ids));
  return check(caption, media, destinations, accounts, problems, await loadCovers(deps, workspaceId, destinations));
}

export async function createPost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  const member = await membership(deps.sql, caller, workspaceId, true, "Reviewers cannot create posts.");
  const caption = parseCaption(input.caption);
  const mediaIds = parseMediaIds(input.media_ids);
  const raw = Array.isArray(input.destinations) ? (input.destinations as Array<Record<string, unknown>>) : [];
  const accounts = await loadAccounts(deps, workspaceId, raw.map((d) => String(d?.account_id ?? "")).filter((id) => /^[0-9a-f-]{36}$/i.test(id)));
  const { destinations, problems } = parseDestinations(caller, input.destinations, accounts);
  if (problems.length) throw new ApiError(400, problems.join(" "));
  await loadMedia(deps, workspaceId, mediaIds);
  await loadCovers(deps, workspaceId, destinations);
  const scheduledAt = parseSchedule(input.scheduled_at);
  const strictest = destinations.map((d) => accounts.get(d.account_id)!.policy).sort((a, b) => ["autonomous", "approve_after_draft", "confirm_each"].indexOf(b) - ["autonomous", "approve_after_draft", "confirm_each"].indexOf(a))[0];

  const [post] = await deps.sql<{ id: string }>(
    `WITH post AS (
       INSERT INTO public.posts (workspace_id, actor_id, entry_point, caption, scheduled_at, effective_approval_policy)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
     ), media AS (
       INSERT INTO public.post_media (post_id, media_asset_id, workspace_id, position)
       SELECT post.id, m.id, $1, m.ord - 1 FROM post, unnest($7::uuid[]) WITH ORDINALITY AS m(id, ord)
     ), dest AS (
       INSERT INTO public.destinations (workspace_id, post_id, connected_account_id, platform, actor_id, effective_approval_policy, options)
       SELECT $1, post.id, (d->>'account_id')::uuid, a.platform, $2,
              coalesce(a.approval_policy_override, w.default_approval_policy), d->'options'
       FROM post, jsonb_array_elements($8::jsonb) AS d
       JOIN public.connected_accounts a ON a.id = (d->>'account_id')::uuid
       JOIN public.workspaces w ON w.id = a.workspace_id
     ), touched AS (
       UPDATE public.media_assets SET last_used_at = now() WHERE id = ANY($7::uuid[])
     )
     SELECT id FROM post`,
    [workspaceId, member.actor_id, caller.entryPoint, caption, scheduledAt, strictest, mediaIds, JSON.stringify(destinations)],
  );
  await audit(deps, workspaceId, member.actor_id, caller, post.id, "post.created", `Created a draft for ${destinations.map((d) => accounts.get(d.account_id)!.display_name).join(", ")}`, undefined, { caption });
  return { ...(await view(deps, post.id)), check: await validatePost(deps, caller, { post_id: post.id }) };
}

export async function updatePost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const postId = requireUuid(input.post_id, "Post");
  const { post, member, destinations } = await loadPost(deps, caller, postId, true);
  if (!EDITABLE.includes(post.status)) {
    throw new ApiError(409, post.status === "processing" ? "This post is being sent right now, so it can't be changed." : "Only drafts and posts waiting to publish can be changed. Create a new post instead.");
  }

  // Changing an approved or scheduled post takes it out of the queue first.
  const queued = post.status === "approved" || post.status === "scheduled";
  // An edit can put a queued post straight back in the queue, which test keys may not do.
  if (queued) assertMayPublish(caller);

  const caption = input.caption === undefined ? post.caption : parseCaption(input.caption);
  const scheduledAt = input.scheduled_at === undefined ? post.scheduled_at : parseSchedule(input.scheduled_at);
  const mediaIds = input.media_ids === undefined ? null : parseMediaIds(input.media_ids);
  if (mediaIds) await loadMedia(deps, post.workspace_id, mediaIds);
  let newDestinations: DestinationInput[] | null = null;
  if (input.destinations !== undefined) {
    const raw = Array.isArray(input.destinations) ? (input.destinations as Array<Record<string, unknown>>) : [];
    const accounts = await loadAccounts(deps, post.workspace_id, raw.map((d) => String(d?.account_id ?? "")).filter((id) => /^[0-9a-f-]{36}$/i.test(id)));
    const parsed = parseDestinations(caller, input.destinations, accounts);
    if (parsed.problems.length) throw new ApiError(400, parsed.problems.join(" "));
    await loadCovers(deps, post.workspace_id, parsed.destinations);
    newDestinations = parsed.destinations;
  }

  // What the post had before, so a failed edit can put a queued post back as it was.
  const mediaBefore = queued
    ? (await deps.sql<{ media_asset_id: string }>(`SELECT media_asset_id FROM public.post_media WHERE post_id = $1 ORDER BY position`, [postId])).map((m) => m.media_asset_id)
    : [];
  const destinationsBefore = queued && newDestinations
    ? (await deps.sql<{ row: Record<string, unknown> }>(`SELECT to_jsonb(d) AS row FROM public.destinations d WHERE d.post_id = $1`, [postId])).map((d) => d.row)
    : null;
  if (queued) {
    const [{ unqueue_post: pulled }] = await deps.sql<{ unqueue_post: boolean }>(`SELECT public.unqueue_post($1)`, [postId]);
    if (!pulled) throw new ApiError(409, "This post started sending, so it can't be changed.");
  }

  let requeued = false;
  let backToApproval = false;
  let invalidEdit = false;
  let nextStatus = post.status;
  try {
    // An edit to something already approved goes back for approval unless every account
    // the post will FINALLY go to is autonomous and would not need approval from this
    // caller under the submit rule (e.g. AI posts to TikTok always do). Judged on the final
    // account list, so adding an account cannot slip past approval.
    const finalAccountIds = newDestinations ? newDestinations.map((d) => d.account_id) : destinations.map((d) => d.connected_account_id);
    const finalAccounts = await loadAccounts(deps, post.workspace_id, finalAccountIds);
    backToApproval = queued && finalAccountIds.some((id) => {
      const account = finalAccounts.get(id)!;
      return account.policy !== "autonomous" || needsApproval(caller.entryPoint, account.policy, account.platform);
    });
    nextStatus = queued ? (backToApproval ? "awaiting_approval" : "approved") : post.status;

    await deps.sql(
      `WITH p AS (
         UPDATE public.posts SET caption = $2, scheduled_at = $3, status = $4 WHERE id = $1 RETURNING id
       )
       UPDATE public.destinations SET status = CASE WHEN $4 = 'awaiting_approval' THEN 'awaiting_approval' WHEN $4 = 'approved' THEN 'approved' ELSE status END
       WHERE post_id = $1 AND status NOT IN ('published', 'cancelled')`,
      [postId, caption, scheduledAt, nextStatus],
    );
    if (mediaIds) await replaceMedia(deps, postId, post.workspace_id, mediaIds);
    if (newDestinations) {
      // Accounts kept on the post are updated in place; removed ones are deleted. (A single
      // delete-then-insert statement would collide with the rows it is replacing.)
      const destinationStatus = nextStatus === "awaiting_approval" ? "awaiting_approval" : nextStatus === "approved" ? "approved" : "draft";
      await deps.sql(
        `DELETE FROM public.destinations WHERE post_id = $1 AND connected_account_id <> ALL($2::uuid[])`,
        [postId, newDestinations.map((d) => d.account_id)],
      );
      await deps.sql(
        `INSERT INTO public.destinations (workspace_id, post_id, connected_account_id, platform, actor_id, effective_approval_policy, options, status)
         SELECT $2, $1, (d->>'account_id')::uuid, a.platform, $3, coalesce(a.approval_policy_override, w.default_approval_policy), d->'options', $4
         FROM jsonb_array_elements($5::jsonb) AS d
         JOIN public.connected_accounts a ON a.id = (d->>'account_id')::uuid JOIN public.workspaces w ON w.id = a.workspace_id
         ON CONFLICT (post_id, connected_account_id) DO UPDATE SET
           options = EXCLUDED.options, status = EXCLUDED.status, effective_approval_policy = EXCLUDED.effective_approval_policy,
           error_code = NULL, error_message = NULL`,
        [postId, post.workspace_id, member.actor_id, destinationStatus, JSON.stringify(newDestinations)],
      );
    }
    // An autonomous edit goes straight back into the queue only if it still passes the
    // checks; otherwise it waits for review instead of failing later at send time.
    if (nextStatus === "approved" && !(await validatePost(deps, caller, { post_id: postId })).ok) {
      invalidEdit = true;
      nextStatus = "awaiting_approval";
      await deps.sql(
        `WITH p AS (UPDATE public.posts SET status = 'awaiting_approval' WHERE id = $1)
         UPDATE public.destinations SET status = 'awaiting_approval' WHERE post_id = $1 AND status = 'approved'`,
        [postId],
      );
    }
    if (backToApproval || invalidEdit) {
      await deps.sql(
        `WITH closed AS (UPDATE public.approval_requests SET status = 'cancelled', closed_at = now() WHERE post_id = $1 AND status = 'pending')
         INSERT INTO public.approval_requests (workspace_id, post_id, policy, requested_by_actor_id) VALUES ($2, $1, 'confirm_each', $3)`,
        [postId, post.workspace_id, member.actor_id],
      );
    }
    if (nextStatus === "approved") {
      await deps.sql(`SELECT public.start_publishing($1)`, [postId]);
      requeued = true;
    }
  } catch (error) {
    // The post was taken out of the queue for this edit. Put it back unchanged so it never
    // sits "scheduled" with nothing queued to send it.
    if (queued && !requeued) await requeueAsBefore(deps, post, mediaBefore, destinationsBefore).catch((restoreError) => reportError(restoreError, { area: "api" }));
    throw error;
  }
  await audit(deps, post.workspace_id, member.actor_id, caller, postId, "post.updated", backToApproval || invalidEdit ? "Edited the post; it needs approval again" : "Edited the post", { caption: post.caption, scheduled_at: post.scheduled_at }, { caption, scheduled_at: scheduledAt });
  return { ...(await view(deps, postId)), check: await validatePost(deps, caller, { post_id: postId }) };
}

// Swaps a post's media. The old rows are cleared in their own statement first: a single
// delete-then-insert statement doesn't see its own delete and collides with the rows it
// is replacing.
async function replaceMedia(deps: PostsDeps, postId: string, workspaceId: string, mediaIds: string[]) {
  await deps.sql(`DELETE FROM public.post_media WHERE post_id = $1`, [postId]);
  if (!mediaIds.length) return;
  await deps.sql(
    `INSERT INTO public.post_media (post_id, media_asset_id, workspace_id, position)
     SELECT $1, m.id, $2, m.ord - 1 FROM unnest($3::uuid[]) WITH ORDINALITY AS m(id, ord)`,
    [postId, workspaceId, mediaIds],
  );
}

// Puts a queued post that failed to change back the way it was and back in the queue. When the
// edit touched its accounts, the accounts it added are removed and the ones it removed or
// changed come back with their old options, so it never sends to accounts nobody approved.
async function requeueAsBefore(deps: PostsDeps, post: PostRow, mediaIds: string[], destinationsBefore: Record<string, unknown>[] | null) {
  await replaceMedia(deps, post.id, post.workspace_id, mediaIds);
  if (destinationsBefore) {
    await deps.sql(`DELETE FROM public.destinations WHERE post_id = $1 AND id <> ALL($2::uuid[])`, [post.id, destinationsBefore.map((d) => String(d.id))]);
    await deps.sql(
      `INSERT INTO public.destinations SELECT * FROM jsonb_populate_recordset(NULL::public.destinations, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET options = EXCLUDED.options, actor_id = EXCLUDED.actor_id,
         effective_approval_policy = EXCLUDED.effective_approval_policy, error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message`,
      [JSON.stringify(destinationsBefore)],
    );
  }
  await deps.sql(
    `WITH req AS (UPDATE public.approval_requests SET status = 'cancelled', closed_at = now() WHERE post_id = $1 AND status = 'pending'),
     p AS (UPDATE public.posts SET caption = $2, scheduled_at = $3, status = 'approved' WHERE id = $1)
     UPDATE public.destinations SET status = 'approved' WHERE post_id = $1 AND status NOT IN ('published', 'cancelled')`,
    [post.id, post.caption, post.scheduled_at],
  );
  await deps.sql(`SELECT public.start_publishing($1)`, [post.id]);
}

// The person a post is credited to in product analytics: the signed-in person, or whoever
// created the key or approved the app an AI used. Looked up only when analytics is on.
async function personFor(deps: PostsDeps, caller: Caller): Promise<string | undefined> {
  if (!isAgentCaller(caller)) return caller.userId;
  if (!tracking()) return undefined;
  try {
    const [row] = await deps.sql<{ user_id: string | null }>(
      `SELECT coalesce(a.user_id, k.created_by, g.user_id) AS user_id
         FROM public.actors a
         LEFT JOIN public.api_keys k ON k.id = a.api_key_id
         LEFT JOIN public.oauth_grants g ON g.id = a.oauth_grant_id
        WHERE a.id = $1`,
      [caller.actorId],
    );
    return row?.user_id ?? undefined;
  } catch {
    return undefined; // analytics must never get in the way of posting
  }
}

export async function submitPost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const postId = requireUuid(input.post_id, "Post");
  assertMayPublish(caller);
  if (input.scheduled_at !== undefined) await updatePost(deps, caller, { post_id: postId, scheduled_at: input.scheduled_at });
  const { post, member, destinations } = await loadPost(deps, caller, postId, true);
  if (post.status !== "draft") throw new ApiError(409, `Only drafts can be submitted (this post is ${post.status.replace("_", " ")}).`);
  const accounts = await loadAccounts(deps, post.workspace_id, destinations.map((d) => d.connected_account_id));
  // The account may have been set to inbox first after this draft was written.
  const blocked = destinations.map((d) => accounts.get(d.connected_account_id)!).find((a, i) => tiktokInboxFirst(caller, a, destinations[i].options));
  if (blocked) throw new ApiError(400, inboxFirst(blocked));
  const result = await validatePost(deps, caller, { post_id: postId });
  if (!result.ok) throw new ApiError(400, `This post can't be published yet. ${result.problems.join(" ")}`);
  const waiting = destinations.filter((d) => needsApproval(caller.entryPoint, accounts.get(d.connected_account_id)!.policy, d.platform));

  try {
    await deps.sql(`SELECT public.assert_within_limit($1, 'posts_per_month', $2)`, [post.workspace_id, destinations.length]);
  } catch (error) {
    const plain = String((error as Error).message).match(/Your .* plan allows .*?limit\./)?.[0];
    if (plain) throw new ApiError(402, plain);
    throw error;
  }

  if (waiting.length) {
    await deps.sql(
      `WITH p AS (UPDATE public.posts SET status = 'awaiting_approval', requested_at = now() WHERE id = $1),
       d AS (UPDATE public.destinations SET status = 'awaiting_approval' WHERE post_id = $1),
       r AS (INSERT INTO public.approval_requests (workspace_id, post_id, policy, requested_by_actor_id) VALUES ($2, $1, 'confirm_each', $3))
       SELECT 1`,
      [postId, post.workspace_id, member.actor_id],
    );
    trackEvent("post_submitted", { workspace_id: post.workspace_id, when: "awaiting_approval", source: caller.entryPoint, destinations: destinations.length }, await personFor(deps, caller));
    await audit(deps, post.workspace_id, member.actor_id, caller, postId, "post.submitted", `Submitted for approval (${waiting.map((d) => accounts.get(d.connected_account_id)!.display_name).join(", ")} ${waiting.length === 1 ? "needs" : "need"} your OK)`);
  } else {
    await deps.sql(
      `WITH p AS (UPDATE public.posts SET status = 'approved', requested_at = now(), approved_at = now() WHERE id = $1),
       d AS (UPDATE public.destinations SET status = 'approved' WHERE post_id = $1)
       SELECT 1`,
      [postId],
    );
    const status = (await deps.sql<{ start_publishing: string }>(`SELECT public.start_publishing($1)`, [postId]))[0].start_publishing;
    // A step of the new-user funnel: the person scheduled a post or sent one out now.
    trackEvent("post_submitted", { workspace_id: post.workspace_id, when: status === "scheduled" ? "later" : "now", source: caller.entryPoint, destinations: destinations.length }, await personFor(deps, caller));
    if (status === "scheduled") trackEvent("post_scheduled", { workspace_id: post.workspace_id, source: caller.entryPoint, destinations: destinations.length }, await personFor(deps, caller));
    await audit(deps, post.workspace_id, member.actor_id, caller, postId, "post.submitted", status === "scheduled" ? `Scheduled for ${post.scheduled_at}` : "Sent for publishing now");
  }
  return view(deps, postId);
}

export async function approvePost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const postId = requireUuid(input.post_id, "Post");
  assertPerson(caller, "approve");
  if (input.caption !== undefined || input.destinations !== undefined || input.media_ids !== undefined || input.scheduled_at !== undefined) {
    // Edit-then-approve: apply the edits first (the post stays awaiting approval).
    await updatePost(deps, caller, { ...input, post_id: postId });
  }
  const { post, member } = await loadPost(deps, caller, postId, true);
  if (post.status !== "awaiting_approval") throw new ApiError(409, "This post is not waiting for approval.");
  const result = await validatePost(deps, caller, { post_id: postId });
  if (!result.ok) throw new ApiError(400, `Fix these before approving. ${result.problems.join(" ")}`);
  const note = typeof input.note === "string" ? input.note.slice(0, 1000) : null;
  await deps.sql(
    `WITH req AS (
       UPDATE public.approval_requests SET status = 'decided', closed_at = now() WHERE post_id = $1 AND status = 'pending' RETURNING id
     ), decision AS (
       INSERT INTO public.approvals (workspace_id, post_id, approval_request_id, decision, actor_id, note)
       SELECT $2, $1, id, 'approved', $3, $4 FROM req
     ), p AS (UPDATE public.posts SET status = 'approved', approved_at = now() WHERE id = $1),
     d AS (UPDATE public.destinations SET status = 'approved' WHERE post_id = $1 AND status = 'awaiting_approval')
     SELECT 1`,
    [postId, post.workspace_id, member.actor_id, note],
  );
  const status = (await deps.sql<{ start_publishing: string }>(`SELECT public.start_publishing($1)`, [postId]))[0].start_publishing;
  await audit(deps, post.workspace_id, member.actor_id, caller, postId, "post.approved", status === "scheduled" ? "Approved; scheduled" : "Approved; publishing now");
  return view(deps, postId);
}

export async function rejectPost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const postId = requireUuid(input.post_id, "Post");
  assertPerson(caller, "reject");
  const { post, member } = await loadPost(deps, caller, postId, true);
  if (post.status !== "awaiting_approval") throw new ApiError(409, "This post is not waiting for approval.");
  const note = typeof input.note === "string" ? input.note.slice(0, 1000) : null;
  await deps.sql(
    `WITH req AS (
       UPDATE public.approval_requests SET status = 'decided', closed_at = now() WHERE post_id = $1 AND status = 'pending' RETURNING id
     ), decision AS (
       INSERT INTO public.approvals (workspace_id, post_id, approval_request_id, decision, actor_id, note)
       SELECT $2, $1, id, 'rejected', $3, $4 FROM req
     ), p AS (UPDATE public.posts SET status = 'draft' WHERE id = $1),
     d AS (UPDATE public.destinations SET status = 'draft' WHERE post_id = $1 AND status = 'awaiting_approval')
     SELECT 1`,
    [postId, post.workspace_id, member.actor_id, note],
  );
  await audit(deps, post.workspace_id, member.actor_id, caller, postId, "post.rejected", note ? `Sent back to draft: ${note}` : "Sent back to draft");
  return view(deps, postId);
}

export async function cancelPost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const postId = requireUuid(input.post_id, "Post");
  const { post, member } = await loadPost(deps, caller, postId, true);
  if (!EDITABLE.includes(post.status)) {
    throw new ApiError(409, post.status === "processing" ? "This post is being sent right now and can't be cancelled." : `This post is already ${post.status.replace("_", " ")}.`);
  }
  const [{ unqueue_post: pulled }] = await deps.sql<{ unqueue_post: boolean }>(`SELECT public.unqueue_post($1)`, [postId]);
  if (!pulled) throw new ApiError(409, "This post started sending, so it can't be cancelled.");
  await deps.sql(
    `WITH req AS (UPDATE public.approval_requests SET status = 'cancelled', closed_at = now() WHERE post_id = $1 AND status = 'pending'),
     d AS (UPDATE public.destinations SET status = 'cancelled' WHERE post_id = $1 AND status NOT IN ('published', 'failed'))
     UPDATE public.posts SET status = 'cancelled' WHERE id = $1`,
    [postId],
  );
  await audit(deps, post.workspace_id, member.actor_id, caller, postId, "post.cancelled", "Cancelled the post");
  return view(deps, postId);
}

export async function reschedulePost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const postId = requireUuid(input.post_id, "Post");
  assertMayPublish(caller);
  const { post, member } = await loadPost(deps, caller, postId, true);
  if (post.status !== "scheduled") throw new ApiError(409, "Only scheduled posts can be rescheduled. Edit the post to change a draft's time.");
  const at = parseSchedule(input.scheduled_at);
  if (!at) throw new ApiError(400, "Give the new time to publish.");
  const moved = await deps.sql<{ id: string }>(
    `WITH p AS (UPDATE public.posts SET scheduled_at = $2 WHERE id = $1)
     UPDATE public.publish_jobs SET next_attempt_at = $2 WHERE post_id = $1 AND state = 'queued' RETURNING id`,
    [postId, at],
  );
  if (!moved.length) throw new ApiError(409, "This post started sending, so it can't be rescheduled.");
  await audit(deps, post.workspace_id, member.actor_id, caller, postId, "post.rescheduled", `Rescheduled to ${at}`, { scheduled_at: post.scheduled_at }, { scheduled_at: at });
  return view(deps, postId);
}

// Deletes a draft or a cancelled post. Anything that was sent or is on its way is kept
// for the record; cancel a waiting post instead.
export async function deletePost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const postId = requireUuid(input.post_id, "Post");
  const { post, member } = await loadPost(deps, caller, postId, true);
  if (post.status !== "draft" && post.status !== "cancelled") {
    throw new ApiError(409, EDITABLE.includes(post.status) ? "Only drafts and cancelled posts can be deleted. Cancel this post first." : `This post is ${post.status.replace("_", " ")}, so it is kept for the record.`);
  }
  await audit(deps, post.workspace_id, member.actor_id, caller, postId, "post.deleted", "Deleted the post", { caption: post.caption, status: post.status });
  await deps.sql(`DELETE FROM public.posts WHERE id = $1 AND status IN ('draft', 'cancelled')`, [postId]);
  return { post_id: postId, deleted: true };
}

export async function getPost(deps: PostsDeps, caller: Caller, input: Record<string, unknown>) {
  const postId = requireUuid(input.post_id, "Post");
  await loadPost(deps, caller, postId, false);
  return view(deps, postId);
}

export const postActions = {
  validate: validatePost,
  create: createPost,
  update: updatePost,
  submit: submitPost,
  approve: approvePost,
  reject: rejectPost,
  cancel: cancelPost,
  reschedule: reschedulePost,
  get: getPost,
  delete: deletePost,
} as const;

export { captionFor };
