import { headers } from "next/headers";
import { loadViewer } from "@/lib/beta/workspace";
import { ApiView, type AiApp, type ApiKey } from "./api-view";

export const metadata = { title: "API/MCP · Post Social" };

export default async function ApiPage() {
  const { viewer, workspace, client } = await loadViewer("/beta/api");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const [{ data: keyRows }, { data: grantRows }] = await Promise.all([
    client.database.from("api_keys").select("id, name, key_prefix, mode, last_used_at, revoked_at, created_at").eq("workspace_id", workspace.id).is("revoked_at", null).order("created_at", { ascending: false }),
    client.database.from("oauth_grants").select("id, label, user_id, last_used_at, created_at, actors(display_name)").eq("workspace_id", workspace.id).is("revoked_at", null).order("created_at", { ascending: false }),
  ]);

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
    <ApiView
      workspaceId={workspace.id}
      role={workspace.role}
      apps={apps}
      keys={keys}
      mcpUrl={`${origin}/mcp`}
      serverName={origin.startsWith("https://www.postsocial.xyz") ? "post-social" : "post-social-dev"}
    />
  );
}
