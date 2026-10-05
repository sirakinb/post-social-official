"use server";

import { cookies } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";

// Asks for fresh stats now (the same action AIs use, at most every 30 minutes per post).
export async function refreshStats(workspaceId: string): Promise<{ ok: boolean; message: string }> {
  const base = process.env.API_BASE_URL;
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!base || !token) return { ok: false, message: "Your session ended. Sign in again." };
  const response = await fetch(`${base}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "refresh_analytics", workspace_id: workspaceId }),
    cache: "no-store",
  }).catch(() => null);
  const data = (await response?.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
  if (!response?.ok) return { ok: false, message: data?.error?.message ?? "Stats could not be refreshed. Try again." };
  return { ok: true, message: data?.message ?? "Refreshing." };
}
