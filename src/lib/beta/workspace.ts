// The signed-in person and the workspace they are looking at, for /beta pages. Reads go
// through row-level security with the person's own session; changes go through the
// server functions (`callServer`), which apply the same rules as the API and MCP.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";

export type Workspace = { id: string; name: string; slug: string; role: string };
export type Viewer = { id: string; email: string; name: string; avatarUrl: string | null };

type MembershipRow = { role: string; workspace_id: string; workspaces: { name: string; slug: string } | null };

// Every /beta page starts here: the person (or a redirect to sign in) and their workspace.
export async function loadViewer(path: string, slug?: string) {
  const user = await currentUser();
  if (!user) redirect(`${BETA_LOGIN}?next=${encodeURIComponent(path)}`);
  const client = await insforgeServerClient();
  const { data } = await client.database.from("workspace_members").select("role, workspace_id, workspaces(name, slug)").eq("user_id", user.id);
  const memberships = ((data ?? []) as unknown as MembershipRow[]).map((m) => ({ id: m.workspace_id, name: m.workspaces?.name ?? "Workspace", slug: m.workspaces?.slug ?? "", role: m.role }));
  const workspace = memberships.find((m) => m.slug === slug) ?? memberships[0] ?? null;
  const profile = (user as { profile?: { name?: string; avatar_url?: string } | null }).profile;
  const viewer: Viewer = { id: user.id, email: user.email, name: profile?.name || user.email.split("@")[0], avatarUrl: profile?.avatar_url ?? null };
  return { viewer, workspace, workspaces: memberships, client };
}

// Calls an action on the `api` function with the person's session (key management,
// connected apps, usage, stats, media links). Returns null on any failure.
export async function callServer<T>(action: string, body: Record<string, unknown>): Promise<T | null> {
  const base = process.env.API_BASE_URL;
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!base || !token) return null;
  const response = await fetch(`${base}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}
