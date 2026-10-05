import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";
import type { GrantSummary, KeySummary } from "./actions";
import { KeysPanel } from "./keys-panel";

export const metadata = { title: "API keys · Post Social beta" };

type Membership = { role: string; workspace_id: string; workspaces: { name: string; slug: string } | null };

export default async function BetaKeysPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const user = await currentUser();
  if (!user) redirect(`${BETA_LOGIN}?next=/beta/keys`);
  const { workspace: slug } = await searchParams;

  const client = await insforgeServerClient();
  const { data: memberData } = await client.database.from("workspace_members").select("role, workspace_id, workspaces(name, slug)").eq("user_id", user.id);
  const memberships = (memberData ?? []) as unknown as Membership[];
  const current = memberships.find((m) => m.workspaces?.slug === slug) ?? memberships[0];

  let keys: KeySummary[] = [];
  let grants: GrantSummary[] = [];
  let loadError = false;
  if (current) {
    // Members can read key names and prefixes; the key hashes are never readable.
    const { data, error } = await client.database
      .from("api_keys")
      .select("id, name, key_prefix, mode, last_used_at, revoked_at, created_at")
      .eq("workspace_id", current.workspace_id)
      .order("created_at", { ascending: false });
    loadError = Boolean(error);
    keys = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      prefix: String(row.key_prefix),
      mode: row.mode === "test" ? "test" : "live",
      last_used_at: (row.last_used_at as string | null) ?? null,
      revoked_at: (row.revoked_at as string | null) ?? null,
      created_at: String(row.created_at),
    }));
    // Apps people signed in to (ChatGPT, the Claude app...). Revoked ones are not shown.
    const { data: grantData, error: grantError } = await client.database
      .from("oauth_grants")
      .select("id, label, user_id, last_used_at, created_at, revoked_at")
      .eq("workspace_id", current.workspace_id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    loadError = loadError || Boolean(grantError);
    grants = ((grantData ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      last_used_at: (row.last_used_at as string | null) ?? null,
      created_at: String(row.created_at),
      mine: row.user_id === user.id,
    }));
  }

  // The API and MCP server are reached through this site's own domain.
  const host = (await headers()).get("host") ?? "www.postsocial.xyz";
  const origin = `${host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https"}://${host}`;

  return (
    <div className="flex flex-col">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:px-8">
        {!current ? (
          <p className="text-sm text-ink-muted">You are not a member of any workspace yet.</p>
        ) : (
          <KeysPanel
            workspaceId={current.workspace_id}
            workspaceName={current.workspaces?.name ?? "Workspace"}
            canManage={current.role === "owner" || current.role === "admin"}
            keys={keys}
            grants={grants}
            loadError={loadError}
            mcpUrl={`${origin}/mcp`}
            apiUrl={`${origin}/api`}
          />
        )}
      </main>
    </div>
  );
}
