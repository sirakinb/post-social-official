"use server";

import { cookies } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";

export type KeySummary = { id: string; name: string; prefix: string; mode: "live" | "test"; last_used_at: string | null; revoked_at: string | null; created_at: string };

// Keys are created and revoked through the `api` function with the person's own session,
// so the same checks (owners and admins only) and audit trail apply.
async function callKeys<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = process.env.API_BASE_URL;
  if (!base) return { ok: false, error: "The API is not configured." };
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!token) return { ok: false, error: "Your session ended. Sign in again." };
  const response = await fetch(`${base}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, error: "The API could not be reached. Try again." };
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) return { ok: false, error: data?.error?.message ?? "Something went wrong. Try again." };
  return { ok: true, data: data as T };
}

export async function createKey(workspaceId: string, name: string, mode: "live" | "test") {
  return callKeys<KeySummary & { key: string }>({ action: "create", workspace_id: workspaceId, name, mode });
}

export async function revokeKey(keyId: string) {
  return callKeys<KeySummary>({ action: "revoke", key_id: keyId });
}

export type GrantSummary = { id: string; label: string; last_used_at: string | null; created_at: string; mine: boolean };

export async function revokeGrant(grantId: string) {
  return callKeys<{ revoked: boolean }>({ action: "revoke_grant", grant_id: grantId });
}
