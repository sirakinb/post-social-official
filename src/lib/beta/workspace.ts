// The signed-in person and the workspace they are looking at, for /beta pages. Reads go
// through row-level security with the person's own session; changes go through the
// server functions (`callServer`), which apply the same rules as the API and MCP.
import { cache } from "react";
import { redirect } from "next/navigation";
import { pageReadsViaApi } from "@/lib/sign-in/rules";
import { sessionToken, signedOutPath } from "@/lib/sign-in/session";
import type { AppFrame, MyWorkspace } from "../../../backend/lib/api/pages";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";

export type Workspace = { id: string; name: string; slug: string; role: string };
export type Viewer = { id: string; email: string; name: string; avatarUrl: string | null };

type MembershipRow = { role: string; workspace_id: string; workspaces: { name: string; slug: string } | null };

// Every /beta page starts here: the person (or a redirect to sign in) and their workspace.
export async function loadViewer(path: string, slug?: string) {
  const user = await currentUser();
  if (!user) redirect(await signedOutPath(path));
  const client = await insforgeServerClient();
  const readMemberships = async (): Promise<Workspace[]> => {
    if (pageReadsViaApi()) return myWorkspaces();
    const { data } = await client.database.from("workspace_members").select("role, workspace_id, workspaces(name, slug)").eq("user_id", user.id);
    return ((data ?? []) as unknown as MembershipRow[]).map((m) => ({ id: m.workspace_id, name: m.workspaces?.name ?? "Workspace", slug: m.workspaces?.slug ?? "", role: m.role }));
  };
  let memberships = await readMemberships();
  // Someone who just signed up has no workspace yet: create theirs (Free plan) and read again.
  if (!memberships.length && (await callServer<{ workspace_id: string }>("provision_workspace", {}))) memberships = await readMemberships();
  const workspace = memberships.find((m) => m.slug === slug) ?? memberships[0] ?? null;
  const profile = (user as { profile?: { name?: string; avatar_url?: string } | null }).profile;
  const viewer: Viewer = { id: user.id, email: user.email, name: profile?.name || user.email.split("@")[0], avatarUrl: profile?.avatar_url ?? null };
  return { viewer, workspace, workspaces: memberships, client };
}

// Calls an action on the `api` function with the person's session (key management,
// connected apps, usage, stats, media links). Returns null on any failure.
export async function callServer<T>(action: string, body: Record<string, unknown>): Promise<T | null> {
  return (await callServerResult<T>(action, body)).data;
}

// The same call, with the reason when it fails, for pages that show it.
export async function callServerResult<T>(action: string, body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const base = process.env.API_BASE_URL;
  const token = await sessionToken();
  if (!base || !token) return { data: null, error: !base ? "The app isn't set up to reach the server." : "You're signed out. Sign in again." };
  const response = await fetch(`${base}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { data: null, error: "The server didn't answer." };
  const json = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) return { data: null, error: json?.error?.message ?? `The server answered ${response.status}.` };
  return { data: json, error: null };
}

// The signed-in person's workspaces, through the API.
export async function myWorkspaces(): Promise<MyWorkspace[]> {
  return (await callServer<{ workspaces: MyWorkspace[] }>("my_workspaces", {}))?.workspaces ?? [];
}

// What surrounds every page (plan, posts this month, getting-started steps), through the
// API. Asked once per page render, however many places show a piece of it.
export const loadFrame = cache((workspaceId: string) => callServer<AppFrame>("app_frame", { workspace_id: workspaceId }));
