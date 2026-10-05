import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";
import { signOut } from "../actions";
import { analyticsEnabled } from "../stats-switch";
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
    <div className="technical-grid flex min-h-screen flex-col">
      <header className="border-b border-border bg-[#080610]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div className="flex items-center gap-6">
            <Brand />
            <nav className="flex gap-4 text-sm">
              <Link href="/beta" className="text-ink-muted hover:text-ink">Home</Link>
              <Link href="/beta/accounts" className="text-ink-muted hover:text-ink">Accounts</Link>
              <Link href="/beta/media" className="text-ink-muted hover:text-ink">Media</Link>
              {analyticsEnabled() && <Link href="/beta/stats" className="text-ink-muted hover:text-ink">Stats</Link>}
              <Link href="/beta/usage" className="text-ink-muted hover:text-ink">Usage</Link>
              <Link href="/beta/keys" aria-current="page" className="font-medium text-ink">API keys</Link>
            </nav>
          </div>
          <form action={signOut}><Button type="submit" variant="secondary">Sign out</Button></form>
        </div>
      </header>
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
