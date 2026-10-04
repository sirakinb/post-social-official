// Lists for API and MCP callers. (The web app reads these through row-level security; keys
// have no database session, so the server reads on their behalf, scoped to the workspace.)
import { ApiError, membership, type Caller, type Sql } from "../access";
import { DISPLAY_NAMES, PLATFORMS, type Platform } from "../connections/platforms";
import { publicAsset, type AssetRow } from "../media/service";

const POST_STATUSES = ["draft", "awaiting_approval", "approved", "scheduled", "processing", "published", "partially_published", "failed", "cancelled"];

export function page(input: { limit?: unknown; offset?: unknown }, max = 100) {
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new ApiError(400, `limit must be a whole number from 1 to ${max}.`);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new ApiError(400, "offset must be a whole number of 0 or more.");
  return { limit, offset };
}

function platformFilter(value: unknown): Platform | null {
  if (value === undefined || value === null || value === "") return null;
  if (!PLATFORMS.includes(value as Platform)) throw new ApiError(400, `platform must be one of: ${PLATFORMS.join(", ")}.`);
  return value as Platform;
}

export async function listAccounts(sql: Sql, caller: Caller, input: { workspace_id: string; platform?: unknown }) {
  await membership(sql, caller, input.workspace_id, false);
  const platform = platformFilter(input.platform);
  const rows = await sql<Record<string, unknown> & { platform: Platform; policy: string }>(
    `SELECT a.id, a.platform, a.handle, a.display_name, a.avatar_url, a.health, a.health_reason, a.capabilities,
            coalesce(a.approval_policy_override, w.default_approval_policy) AS policy, a.created_at
     FROM public.connected_accounts a JOIN public.workspaces w ON w.id = a.workspace_id
     WHERE a.workspace_id = $1 AND ($2::text IS NULL OR a.platform = $2)
     ORDER BY a.platform, a.display_name`,
    [input.workspace_id, platform],
  );
  return {
    accounts: rows.map(({ policy, ...row }) => ({
      ...row,
      platform_name: DISPLAY_NAMES[row.platform],
      approval: policy === "autonomous" ? "AI posts publish without asking" : "AI posts wait for your approval",
    })),
  };
}

export async function listPosts(sql: Sql, caller: Caller, input: { workspace_id: string; status?: unknown; platform?: unknown; limit?: unknown; offset?: unknown }) {
  await membership(sql, caller, input.workspace_id, false);
  const { limit, offset } = page(input);
  const status = input.status === undefined || input.status === "" ? null : String(input.status);
  if (status && !POST_STATUSES.includes(status)) throw new ApiError(400, `status must be one of: ${POST_STATUSES.join(", ")}.`);
  const platform = platformFilter(input.platform);
  const rows = await sql<Record<string, unknown>>(
    `SELECT p.id, p.status, left(p.caption, 280) AS caption, p.scheduled_at, p.created_at, p.updated_at,
            coalesce(act.display_name, 'Unknown') AS created_by, p.entry_point AS created_via,
            (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', d.id, 'account_id', d.connected_account_id, 'account', a.display_name, 'platform', d.platform,
                'status', d.status, 'live_url', d.live_url, 'error', d.error_message) ORDER BY d.created_at), '[]'::jsonb)
             FROM public.destinations d JOIN public.connected_accounts a ON a.id = d.connected_account_id
             WHERE d.post_id = p.id) AS destinations
     FROM public.posts p LEFT JOIN public.actors act ON act.id = p.actor_id
     WHERE p.workspace_id = $1 AND ($2::text IS NULL OR p.status = $2)
       AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM public.destinations d WHERE d.post_id = p.id AND d.platform = $3))
     ORDER BY coalesce(p.scheduled_at, p.created_at) DESC, p.id
     LIMIT $4 OFFSET $5`,
    [input.workspace_id, status, platform, limit + 1, offset],
  );
  return { posts: rows.slice(0, limit), has_more: rows.length > limit, limit, offset };
}

// Per-destination outcomes: one post's, or the most recent across the workspace.
export async function listResults(sql: Sql, caller: Caller, input: { workspace_id: string; post_id?: string; limit?: unknown; offset?: unknown }) {
  await membership(sql, caller, input.workspace_id, false);
  const { limit, offset } = page(input);
  const rows = await sql<Record<string, unknown>>(
    `SELECT d.post_id, d.id AS destination_id, d.platform, a.display_name AS account, d.status, d.live_url,
            d.error_code, d.error_message, d.updated_at
     FROM public.destinations d JOIN public.connected_accounts a ON a.id = d.connected_account_id
     WHERE d.workspace_id = $1 AND ($2::uuid IS NULL OR d.post_id = $2)
       AND d.status IN ('published', 'failed', 'processing', 'queued', 'scheduled', 'cancelled')
     ORDER BY d.updated_at DESC, d.id
     LIMIT $3 OFFSET $4`,
    [input.workspace_id, input.post_id ?? null, limit + 1, offset],
  );
  return { results: rows.slice(0, limit), has_more: rows.length > limit, limit, offset };
}

export async function listMedia(sql: Sql, caller: Caller, input: { workspace_id: string; media_type?: unknown; include_hidden?: unknown; limit?: unknown; offset?: unknown }) {
  await membership(sql, caller, input.workspace_id, false);
  const { limit, offset } = page(input);
  const mediaType = input.media_type === undefined || input.media_type === "" ? null : String(input.media_type);
  if (mediaType && mediaType !== "image" && mediaType !== "video") throw new ApiError(400, "media_type must be image or video.");
  const rows = await sql<AssetRow>(
    `SELECT * FROM public.media_assets
     WHERE workspace_id = $1 AND status <> 'uploading' AND ($2::text IS NULL OR media_type = $2)
       AND ($3::boolean OR hidden_from_library_at IS NULL)
     ORDER BY created_at DESC, id
     LIMIT $4 OFFSET $5`,
    [input.workspace_id, mediaType, input.include_hidden === true || input.include_hidden === "true", limit + 1, offset],
  );
  return { media: rows.slice(0, limit).map(publicAsset), has_more: rows.length > limit, limit, offset };
}
