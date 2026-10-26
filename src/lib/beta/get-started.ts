// The three steps from sign-up to a first post, read from what the workspace already has.
// Shown on Accounts and as progress in the sidebar until all three are done (or hidden).

export type GetStarted = { account: boolean; ai: boolean; post: boolean };

export const GET_STARTED_HIDDEN_COOKIE = "ps-get-started-hidden";

// Sent, scheduled or on its way: everything except drafts, cancelled and failed posts.
const SENT = ["awaiting_approval", "approved", "scheduled", "processing", "published", "partially_published"];

type Client = Awaited<ReturnType<typeof import("@/lib/insforge/server").insforgeServerClient>>;

export async function loadGetStarted(client: Client, workspaceId: string): Promise<GetStarted> {
  const one = (q: PromiseLike<{ data: unknown[] | null }>) => Promise.resolve(q).then((r) => (r.data ?? []).length > 0, () => false);
  const [account, app, key, post] = await Promise.all([
    one(client.database.from("connected_accounts").select("id").eq("workspace_id", workspaceId).limit(1)),
    one(client.database.from("oauth_grants").select("id").eq("workspace_id", workspaceId).is("revoked_at", null).limit(1)),
    one(client.database.from("api_keys").select("id").eq("workspace_id", workspaceId).is("revoked_at", null).limit(1)),
    one(client.database.from("posts").select("id").eq("workspace_id", workspaceId).in("status", SENT).limit(1)),
  ]);
  return { account, ai: app || key, post };
}

export function stepsDone(s: GetStarted): number {
  return Number(s.account) + Number(s.ai) + Number(s.post);
}
