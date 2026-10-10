"use server";

import { cookies, headers } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { OUR_SIDE, UNREACHABLE, requestError } from "../../../../../backend/lib/support";

// The web app uses the same `connections` function an AI client will, with the person's
// own session, so connecting and disconnecting get the same checks and audit trail.
type Path = "/start" | "/disconnect" | "/profiles/create" | "/profiles/update" | "/profiles/delete" | "/accounts/move";
async function callConnections<T>(path: Path, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = process.env.CONNECTIONS_BASE_URL;
  if (!base) return { ok: false, error: OUR_SIDE };
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!token) return { ok: false, error: "Your session ended. Sign in again." };
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, error: UNREACHABLE };
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) return { ok: false, error: requestError(response.status, data?.error) };
  return { ok: true, data: data as T };
}

export async function startConnection(workspaceId: string, workspaceSlug: string, platform: string, handle?: string, profileId?: string | null) {
  const host = (await headers()).get("host");
  const protocol = host?.startsWith("localhost") ? "http" : "https";
  const returnTo = `${protocol}://${host}/beta/accounts?workspace=${encodeURIComponent(workspaceSlug)}`;
  return callConnections<{ url: string }>("/start", { workspace_id: workspaceId, platform, return_to: returnTo, ...(handle?.trim() ? { handle: handle.trim() } : {}), ...(profileId ? { profile_id: profileId } : {}) });
}

export async function disconnect(accountId: string) {
  return callConnections<{ revoked: string; cancelled_destinations: number }>("/disconnect", { account_id: accountId });
}

export type ProfileInput = { name: string; description: string; color: string; timezone: string };

export async function createProfile(workspaceId: string, input: ProfileInput) {
  return callConnections<{ profile: { id: string } }>("/profiles/create", { workspace_id: workspaceId, ...input });
}

export async function updateProfile(profileId: string, input: ProfileInput) {
  return callConnections<{ profile: { id: string } }>("/profiles/update", { profile_id: profileId, ...input });
}

export async function deleteProfile(profileId: string) {
  return callConnections<{ accounts_moved: number }>("/profiles/delete", { profile_id: profileId });
}

export async function moveAccount(accountId: string, profileId: string | null) {
  return callConnections<{ profile_id: string | null }>("/accounts/move", { account_id: accountId, profile_id: profileId });
}
