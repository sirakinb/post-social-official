"use server";

import { cookies, headers } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";

// The web app uses the same `connections` function an AI client will, with the person's
// own session, so connecting and disconnecting get the same checks and audit trail.
async function callConnections<T>(path: "/start" | "/disconnect", body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = process.env.CONNECTIONS_BASE_URL;
  if (!base) return { ok: false, error: "Connections are not configured." };
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!token) return { ok: false, error: "Your session ended. Sign in again." };
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, error: "The connection service could not be reached. Try again." };
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) return { ok: false, error: data?.error ?? "Something went wrong. Try again." };
  return { ok: true, data: data as T };
}

export async function startConnection(workspaceId: string, workspaceSlug: string, platform: string, handle?: string) {
  const host = (await headers()).get("host");
  const protocol = host?.startsWith("localhost") ? "http" : "https";
  const returnTo = `${protocol}://${host}/beta/accounts?workspace=${encodeURIComponent(workspaceSlug)}`;
  return callConnections<{ url: string }>("/start", { workspace_id: workspaceId, platform, return_to: returnTo, ...(handle?.trim() ? { handle: handle.trim() } : {}) });
}

export async function disconnect(accountId: string) {
  return callConnections<{ revoked: string; cancelled_destinations: number }>("/disconnect", { account_id: accountId });
}
