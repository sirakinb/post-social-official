import { headers } from "next/headers";
import { loadViewer } from "@/lib/beta/workspace";
import { ConnectionsView, type SocialAccount, type AiApp, type ApiKey } from "./connections-view";

export const metadata = { title: "Accounts & AI · Post Social" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; message?: string; error?: string; connect?: string }> }) {
  const params = await searchParams;
  const { viewer, workspace, client } = await loadViewer("/beta/accounts");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const [{ data: accountRows, error: accountError }, { data: keyRows }, { data: grantRows }, { data: lastPosts }] = await Promise.all([
    client.database.from("connected_accounts").select("id, platform, handle, display_name, avatar_url, health, health_reason, capabilities, created_at").eq("workspace_id", workspace.id).order("platform").order("display_name"),
    client.database.from("api_keys").select("id, name, key_prefix, mode, last_used_at, revoked_at, created_at").eq("workspace_id", workspace.id).is("revoked_at", null).order("created_at", { ascending: false }),
    client.database.from("oauth_grants").select("id, label, user_id, last_used_at, created_at, actors(display_name)").eq("workspace_id", workspace.id).is("revoked_at", null).order("created_at", { ascending: false }),
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
  const keys: ApiKey[] = ((keyRows ?? []) as Array<{ id: string; name: string; key_prefix: string; mode: "live" | "test"; last_used_at: string | null; created_at: string }>).map((k) => ({ id: k.id, name: k.name, prefix: k.key_prefix, mode: k.mode, lastUsedAt: k.last_used_at, createdAt: k.created_at }));
  const apps: AiApp[] = ((grantRows ?? []) as unknown as Array<{ id: string; label: string; user_id: string; last_used_at: string | null; created_at: string; actors: Array<{ display_name: string }> | null }>).map((g) => ({
    id: g.id,
    name: g.actors?.[0]?.display_name ?? g.label.split(",")[0],
    label: g.label,
    mine: g.user_id === viewer.id,
    lastUsedAt: g.last_used_at,
    createdAt: g.created_at,
  }));

  const host = (await headers()).get("host") ?? "www.postsocial.xyz";
  const origin = `${host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https"}://${host}`;

  return (
    <ConnectionsView
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
      role={workspace.role}
      accounts={accounts}
      apps={apps}
      keys={keys}
      loadError={Boolean(accountError)}
      notice={params.message ?? null}
      error={params.error ?? null}
      requested={params.connect ?? null}
      mcpUrl={`${origin}/mcp`}
      serverName={origin.startsWith("https://www.postsocial.xyz") ? "post-social" : "post-social-dev"}
    />
  );
}
