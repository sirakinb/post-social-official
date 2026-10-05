import { redirect } from "next/navigation";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";
import { AccountsPanel, type ConnectedAccount } from "./accounts-panel";

export const metadata = { title: "Accounts · Post Social beta" };

type Membership = { role: string; workspace_id: string; workspaces: { name: string; slug: string } | null };

export default async function BetaAccountsPage({ searchParams }: { searchParams: Promise<{ workspace?: string; connected?: string; message?: string; error?: string; connect?: string }> }) {
  const user = await currentUser();
  if (!user) redirect(`${BETA_LOGIN}?next=/beta/accounts`);
  const { workspace: slug, message, error, connect } = await searchParams;

  const client = await insforgeServerClient();
  const { data: memberData } = await client.database.from("workspace_members").select("role, workspace_id, workspaces(name, slug)").eq("user_id", user.id);
  const memberships = (memberData ?? []) as unknown as Membership[];
  const current = memberships.find((m) => m.workspaces?.slug === slug) ?? memberships[0];

  let accounts: ConnectedAccount[] = [];
  let loadError = false;
  if (current) {
    const { data, error: queryError } = await client.database
      .from("connected_accounts")
      .select("id, platform, handle, display_name, avatar_url, health, health_reason, capabilities, updated_at")
      .eq("workspace_id", current.workspace_id)
      .order("platform")
      .order("display_name");
    loadError = Boolean(queryError);
    accounts = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      platform: String(row.platform),
      handle: String(row.handle),
      displayName: String(row.display_name),
      avatarUrl: (row.avatar_url as string | null) ?? undefined,
      health: String(row.health),
      healthReason: (row.health_reason as string | null) ?? null,
      postTypes: ((row.capabilities as { post_types?: string[] } | null)?.post_types ?? []) as string[],
    }));
  }

  return (
    <div className="flex flex-col">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:px-8">
        {!current ? (
          <p className="text-sm text-ink-muted">You are not a member of any workspace yet.</p>
        ) : (
          <AccountsPanel
            workspaceId={current.workspace_id}
            workspaceSlug={current.workspaces?.slug ?? ""}
            workspaceName={current.workspaces?.name ?? "Workspace"}
            canEdit={current.role !== "reviewer"}
            accounts={accounts}
            loadError={loadError}
            notice={message ?? null}
            error={error ?? null}
            requested={connect ?? null}
          />
        )}
      </main>
    </div>
  );
}
