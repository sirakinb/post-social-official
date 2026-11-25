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

// The actions above by name, for the route that serves them, and which of them only read.
export const pageActions = {
  my_workspaces: (sql: Sql, caller: Caller) => myWorkspaces(sql, caller),
  app_frame: appFrame,
};
export const isPageRead = (action: string) => Object.hasOwn(pageActions, action);
