import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";
import { signOut } from "../actions";
import { MediaLibrary, type MediaItem } from "./media-library";

export const metadata = { title: "Media · Post Social beta" };

type Membership = { role: string; workspace_id: string; workspaces: { name: string; slug: string } | null };

export default async function BetaMediaPage({ searchParams }: { searchParams: Promise<{ workspace?: string; hidden?: string }> }) {
  const user = await currentUser();
  if (!user) redirect(`${BETA_LOGIN}?next=/beta/media`);
  const { workspace: slug, hidden } = await searchParams;
  const showHidden = hidden === "1";

  const client = await insforgeServerClient();
  const { data: memberData } = await client.database
    .from("workspace_members")
    .select("role, workspace_id, workspaces(name, slug)")
    .eq("user_id", user.id);
  const memberships = (memberData ?? []) as unknown as Membership[];
  const current = memberships.find((m) => m.workspaces?.slug === slug) ?? memberships[0];

  let items: MediaItem[] = [];
  let loadError = false;
  if (current) {
    let query = client.database
      .from("media_assets")
      .select("id, status, display_name, file_name, media_type, size_bytes, width, height, duration_seconds, failure_reason, hidden_from_library_at, created_at")
      .eq("workspace_id", current.workspace_id)
      .neq("status", "uploading")
      .order("created_at", { ascending: false })
      .limit(200);
    query = showHidden ? query.not("hidden_from_library_at", "is", null) : query.is("hidden_from_library_at", null);
    const { data, error } = await query;
    loadError = Boolean(error);
    items = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      status: String(row.status),
      name: String(row.display_name ?? row.file_name),
      mediaType: String(row.media_type),
      sizeBytes: Number(row.size_bytes),
      width: row.width === null ? null : Number(row.width),
      height: row.height === null ? null : Number(row.height),
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      failureReason: (row.failure_reason as string | null) ?? null,
      hidden: row.hidden_from_library_at !== null,
      createdAt: String(row.created_at),
    }));
  }

  return (
    <div className="technical-grid flex min-h-screen flex-col">
      <header className="border-b border-border bg-[#080610]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div className="flex items-center gap-6">
            <Brand />
            <nav className="flex gap-4 text-sm">
              <Link href="/beta" className="text-ink-muted hover:text-ink">Home</Link>
              <Link href="/beta/accounts" className="text-ink-muted hover:text-ink">Accounts</Link>
              <Link href="/beta/media" aria-current="page" className="font-medium text-ink">Media</Link>
              <Link href="/beta/usage" className="text-ink-muted hover:text-ink">Usage</Link>
              <Link href="/beta/keys" className="text-ink-muted hover:text-ink">API keys</Link>
            </nav>
          </div>
          <form action={signOut}><Button type="submit" variant="secondary">Sign out</Button></form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:px-8">
        {!current ? (
          <p className="text-sm text-ink-muted">You are not a member of any workspace yet.</p>
        ) : (
          <MediaLibrary
            workspaceId={current.workspace_id}
            workspaceSlug={current.workspaces?.slug ?? ""}
            workspaceName={current.workspaces?.name ?? "Workspace"}
            canEdit={current.role !== "reviewer"}
            showHidden={showHidden}
            items={items}
            loadError={loadError}
          />
        )}
      </main>
    </div>
  );
}
