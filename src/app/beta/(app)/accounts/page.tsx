import { loadViewer } from "@/lib/beta/workspace";
import { ConnectionsView, type Profile, type SocialAccount } from "./connections-view";

export const metadata = { title: "Accounts · Post Social" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; message?: string; error?: string; connect?: string; profile?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/accounts");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const COLUMNS = "id, platform, handle, display_name, avatar_url, health, health_reason, capabilities, created_at";
  const accountsQuery = (columns: string) => client.database.from("connected_accounts").select(columns).eq("workspace_id", workspace.id).order("platform").order("display_name");
  const [accountsResult, { data: lastPosts }, profilesResult] = await Promise.all([
    accountsQuery(`${COLUMNS}, profile_id`),
    client.database.from("destinations").select("connected_account_id, updated_at").eq("workspace_id", workspace.id).eq("status", "published").order("updated_at", { ascending: false }).limit(200),
    client.database.from("profiles").select("id, name, description, color, timezone").eq("workspace_id", workspace.id).order("name"),
  ]);
  // Before the profiles migration reaches an environment, read accounts without them.
  const profilesReady = !profilesResult.error;
  if (profilesResult.error) console.error("profiles could not be read", profilesResult.error);
  const { data: accountRows, error: accountError } = profilesReady && !accountsResult.error ? accountsResult : await accountsQuery(COLUMNS);
  const profiles = ((profilesResult.data ?? []) as Profile[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const lastPosted = new Map<string, string>();
  for (const d of (lastPosts ?? []) as Array<{ connected_account_id: string; updated_at: string }>) if (!lastPosted.has(d.connected_account_id)) lastPosted.set(d.connected_account_id, d.updated_at);

  const accounts: SocialAccount[] = ((accountRows ?? []) as unknown as Array<{ id: string; platform: string; handle: string; display_name: string; avatar_url: string | null; health: string; health_reason: string | null; capabilities: { post_types?: string[] } | null; created_at: string; profile_id?: string | null }>).map((a) => ({
    id: a.id,
    platform: a.platform,
    handle: a.handle,
    name: a.display_name,
    avatarUrl: a.avatar_url,
    health: a.health,
    reason: a.health_reason,
    postTypes: a.capabilities?.post_types ?? [],
    connectedAt: a.created_at,
    lastPostedAt: lastPosted.get(a.id) ?? null,
    profileId: a.profile_id ?? null,
  }));


  return (
    <ConnectionsView
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
      role={workspace.role}
      accounts={accounts}
      profiles={profiles}
      profilesReady={profilesReady}
      filter={params.profile ?? null}
      connectProfile={params.connect ? (params.profile ?? null) : null}
      loadError={Boolean(accountError)}
      notice={params.message ?? null}
      error={params.error ?? null}
      requested={params.connect ?? null}
    />
  );
}
