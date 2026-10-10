import { loadViewer } from "@/lib/beta/workspace";
import { ConnectionsView, type SocialAccount } from "./connections-view";

export const metadata = { title: "Accounts · Post Social" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; message?: string; error?: string; connect?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/accounts");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const [{ data: accountRows, error: accountError }, { data: lastPosts }] = await Promise.all([
    client.database.from("connected_accounts").select("id, platform, handle, display_name, avatar_url, health, health_reason, capabilities, created_at").eq("workspace_id", workspace.id).order("platform").order("display_name"),
    client.database.from("destinations").select("connected_account_id, updated_at").eq("workspace_id", workspace.id).eq("status", "published").order("updated_at", { ascending: false }).limit(200),
  ]);

  const lastPosted = new Map<string, string>();
  for (const d of (lastPosts ?? []) as Array<{ connected_account_id: string; updated_at: string }>) if (!lastPosted.has(d.connected_account_id)) lastPosted.set(d.connected_account_id, d.updated_at);

  const accounts: SocialAccount[] = ((accountRows ?? []) as Array<{ id: string; platform: string; handle: string; display_name: string; avatar_url: string | null; health: string; health_reason: string | null; capabilities: { post_types?: string[] } | null; created_at: string }>).map((a) => ({
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
  }));


  return (
    <ConnectionsView
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
      role={workspace.role}
      accounts={accounts}
      loadError={Boolean(accountError)}
      notice={params.message ?? null}
      error={params.error ?? null}
      requested={params.connect ?? null}
    />
  );
}
