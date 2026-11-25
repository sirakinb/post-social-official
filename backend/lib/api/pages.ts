// What the web app's pages read, for the signed-in person. The pages used to read these
// straight from the database with the person's own session, which only works while the
// database is InsForge's. Here the server reads for them, after checking they belong to the
// workspace, the same way it does for everything else a person does in the app.
//
// One action per page (or per piece several pages share), each answered with as few
// statements as it can: on InsForge every statement is a round trip.
import { ApiError, isAgentCaller, membership, requireUuid, type Caller, type Sql } from "../access";

// Sent, scheduled or on its way: everything except drafts, cancelled and failed posts.
const SENT = ["awaiting_approval", "approved", "scheduled", "processing", "published", "partially_published"];

// These are for a person in the web app. Keys and signed-in apps have the REST API and MCP.
function personOnly(caller: Caller) {
  if (isAgentCaller(caller)) throw new ApiError(403, "This is for people signed in to the web app.");
  return caller;
}

export type MyWorkspace = { id: string; name: string; slug: string; role: string };

// Every workspace the person belongs to, the one they joined first at the top.
export async function myWorkspaces(sql: Sql, caller: Caller): Promise<{ workspaces: MyWorkspace[] }> {
  const person = personOnly(caller);
  const workspaces = await sql<MyWorkspace>(
    `SELECT w.id, w.name, w.slug, m.role
     FROM public.workspace_members m JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = $1
     ORDER BY m.created_at, w.id`,
    [person.userId],
  );
  return { workspaces };
}

export type AppFrame = {
  // The plan and how many posts went out this month (UTC), for the sidebar. Null when the
  // workspace has no plan row.
  plan: { name: string; max_posts_per_month: number } | null;
  posts_published: number;
  // The three steps from sign-up to a first post.
  steps: { account: boolean; ai: boolean; post: boolean };
};

// What every page of the signed-in app shows around the page itself.
export async function appFrame(sql: Sql, caller: Caller, input: { workspace_id?: unknown }): Promise<AppFrame> {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(sql, personOnly(caller), workspaceId, false);
  const [row] = await sql<{ plan: AppFrame["plan"]; posts_published: string | number; account: boolean; app: boolean; key: boolean; post: boolean }>(
    `SELECT
       (SELECT json_build_object('name', p.name, 'max_posts_per_month', p.max_posts_per_month)
        FROM public.workspace_plans wp JOIN public.plans p ON p.id = wp.plan_id WHERE wp.workspace_id = $1) AS plan,
       (SELECT coalesce(sum(u.quantity), 0) FROM public.usage_events u
        WHERE u.workspace_id = $1 AND u.event_type = 'post_published'
          AND u.occurred_at >= date_trunc('month', now()) AND u.occurred_at < date_trunc('month', now()) + interval '1 month') AS posts_published,
       EXISTS (SELECT 1 FROM public.connected_accounts a WHERE a.workspace_id = $1) AS account,
       EXISTS (SELECT 1 FROM public.oauth_grants g WHERE g.workspace_id = $1 AND g.revoked_at IS NULL) AS app,
       -- A key counts once an AI has used it, not just for being created.
       EXISTS (SELECT 1 FROM public.api_keys k WHERE k.workspace_id = $1 AND k.revoked_at IS NULL AND k.last_used_at IS NOT NULL) AS key,
       EXISTS (SELECT 1 FROM public.posts o WHERE o.workspace_id = $1 AND o.status = ANY($2::text[])) AS post`,
    [workspaceId, SENT],
  );
  return {
    plan: row?.plan ?? null,
    posts_published: Number(row?.posts_published ?? 0),
    steps: { account: Boolean(row?.account), ai: Boolean(row?.app || row?.key), post: Boolean(row?.post) },
  };
}

// A workspace the person belongs to, from what the page sent.
async function memberOf(sql: Sql, caller: Caller, input: { workspace_id?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(sql, personOnly(caller), workspaceId, false);
  return workspaceId;
}

const optionalUuid = (value: unknown, label: string) => (value === undefined || value === null || value === "" ? null : requireUuid(value, label));

// The Accounts page: every connected account, when each last posted, and the profiles.
export async function accountsPage(sql: Sql, caller: Caller, input: { workspace_id?: unknown }) {
  const workspaceId = await memberOf(sql, caller, input);
  const [row] = await sql<{ accounts: unknown[]; last_posted: unknown[]; profiles: unknown[] }>(
    `SELECT
       (SELECT coalesce(json_agg(a ORDER BY a.platform, a.display_name), '[]') FROM (
          SELECT id, platform, handle, display_name, avatar_url, health, health_reason, capabilities, created_at,
                 profile_id, scopes, last_connected_at, tiktok_delivery
          FROM public.connected_accounts WHERE workspace_id = $1) a) AS accounts,
       (SELECT coalesce(json_agg(d), '[]') FROM (
          SELECT connected_account_id, max(updated_at) AS updated_at
          FROM public.destinations WHERE workspace_id = $1 AND status = 'published' GROUP BY connected_account_id) d) AS last_posted,
       (SELECT coalesce(json_agg(p ORDER BY p.name), '[]') FROM (
          SELECT id, name, description, color, timezone FROM public.profiles WHERE workspace_id = $1) p) AS profiles`,
    [workspaceId],
  );
  return { accounts: row?.accounts ?? [], last_posted: row?.last_posted ?? [], profiles: row?.profiles ?? [] };
}

const MEDIA_COLUMNS = "id, display_name, file_name, media_type, width, height, duration_seconds";

// The composer: the accounts that can be posted to, the newest ready media, the profiles,
// the post being edited (if one was asked for), and a file still being checked that the
// composer should wait for (if one was asked for).
export async function composerPage(sql: Sql, caller: Caller, input: { workspace_id?: unknown; post_id?: unknown; media_id?: unknown }) {
  const workspaceId = await memberOf(sql, caller, input);
  const postId = optionalUuid(input.post_id, "Post");
  const mediaId = optionalUuid(input.media_id, "Media");
  const [row] = await sql<{ accounts: unknown[]; media: unknown[]; profiles: unknown[]; post: unknown; pending_media: unknown }>(
    `SELECT
       (SELECT coalesce(json_agg(a ORDER BY a.platform), '[]') FROM (
          SELECT id, platform, handle, display_name, avatar_url, health, capabilities, profile_id
          FROM public.connected_accounts WHERE workspace_id = $1 AND health <> 'disconnected') a) AS accounts,
       (SELECT coalesce(json_agg(m ORDER BY m.created_at DESC), '[]') FROM (
          SELECT ${MEDIA_COLUMNS}, created_at FROM public.media_assets
          WHERE workspace_id = $1 AND status = 'ready' AND hidden_from_library_at IS NULL
          ORDER BY created_at DESC LIMIT 48) m) AS media,
       (SELECT coalesce(json_agg(p), '[]') FROM (SELECT id, name, color FROM public.profiles WHERE workspace_id = $1) p) AS profiles,
       (SELECT json_build_object(
          'id', o.id, 'status', o.status, 'caption', o.caption, 'scheduled_at', o.scheduled_at,
          'destinations', (SELECT coalesce(json_agg(json_build_object('connected_account_id', d.connected_account_id, 'platform', d.platform, 'options', d.options)), '[]')
                           FROM public.destinations d WHERE d.post_id = o.id),
          'post_media', (SELECT coalesce(json_agg(json_build_object('position', pm.position, 'media_asset_id', pm.media_asset_id)), '[]')
                         FROM public.post_media pm WHERE pm.post_id = o.id))
        FROM public.posts o WHERE o.id = $2::uuid AND o.workspace_id = $1) AS post,
       (SELECT json_build_object('id', w.id, 'display_name', w.display_name, 'file_name', w.file_name)
        FROM public.media_assets w WHERE w.id = $3::uuid AND w.workspace_id = $1 AND w.status IN ('uploading', 'processing')) AS pending_media`,
    [workspaceId, postId, mediaId],
  );
  return { accounts: row?.accounts ?? [], media: row?.media ?? [], profiles: row?.profiles ?? [], post: row?.post ?? null, pending_media: row?.pending_media ?? null };
}

// Media by id, for a post being edited whose files aren't among the newest. Only this
// workspace's: an id from anywhere else comes back as nothing.
export async function mediaByIds(sql: Sql, caller: Caller, input: { workspace_id?: unknown; ids?: unknown }) {
  const workspaceId = await memberOf(sql, caller, input);
  if (!Array.isArray(input.ids) || input.ids.length > 60) throw new ApiError(400, "ids must be a list of up to 60 media ids.");
  const ids = input.ids.map((id) => requireUuid(id, "Media"));
  if (!ids.length) return { media: [] };
  const media = await sql(`SELECT ${MEDIA_COLUMNS} FROM public.media_assets WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [workspaceId, ids]);
  return { media };
}

// The accounts the Inbox works with: Instagram, Facebook Pages, Threads and LinkedIn that
// are still connected. (The page keeps LinkedIn Company Pages only.)
export async function inboxAccountsList(sql: Sql, caller: Caller, input: { workspace_id?: unknown }) {
  const workspaceId = await memberOf(sql, caller, input);
  const accounts = await sql(
    `SELECT id, platform, handle, display_name, external_account_id FROM public.connected_accounts
     WHERE workspace_id = $1 AND platform IN ('instagram', 'facebook', 'threads', 'linkedin') AND health <> 'disconnected'
     ORDER BY display_name`,
    [workspaceId],
  );
  return { accounts };
}

// The actions above by name, for the route that serves them, and which of them only read.
export const pageActions = {
  my_workspaces: (sql: Sql, caller: Caller) => myWorkspaces(sql, caller),
  app_frame: appFrame,
  accounts_page: accountsPage,
  composer_page: composerPage,
  media_by_ids: mediaByIds,
  inbox_accounts: inboxAccountsList,
};
export const isPageRead = (action: string) => Object.hasOwn(pageActions, action);
