"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { sessionToken } from "@/lib/sign-in/session";
import { OUR_SIDE, UNREACHABLE, requestError } from "../../../../../backend/lib/support";
import { GET_STARTED_HIDDEN_COOKIE } from "@/lib/beta/get-started";
import { flashCookie } from "@/lib/beta/flash";

// The web app uses the same `connections` function an AI client will, with the person's
// own session, so connecting and disconnecting get the same checks and audit trail.
type Path = "/start" | "/disconnect" | "/profiles/create" | "/profiles/update" | "/profiles/delete" | "/accounts/move" | "/accounts/tiktok-delivery" | "/accounts/pending" | "/accounts/choose";
async function callConnections<T>(path: Path, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = process.env.CONNECTIONS_BASE_URL;
  if (!base) return { ok: false, error: OUR_SIDE };
  const token = await sessionToken();
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

// TikTok only: whether AI posts to this account post directly or go to the TikTok inbox first.
export async function setTiktokDelivery(accountId: string, delivery: "direct" | "inbox") {
  return callConnections<{ tiktok_delivery: "direct" | "inbox" }>("/accounts/tiktok-delivery", { account_id: accountId, delivery });
}

// "Hide" on the get-started steps: gone from Accounts and the sidebar in this browser.
export async function hideGetStarted() {
  (await cookies()).set(GET_STARTED_HIDDEN_COOKIE, "1", { path: "/", maxAge: 31536000, sameSite: "lax" });
  revalidatePath("/beta", "layout");
}

// A sign-in that brought several new accounts (a LinkedIn profile and Pages) waits for the
// person to choose which to add.
export type PendingChoice = { external_id: string; name: string; kind: "profile" | "page" | null; avatar_url: string | null };
export async function loadPendingChoices(pendingId: string) {
  return callConnections<{ platform: string; workspace_id: string; choices: PendingChoice[] }>("/accounts/pending", { pending_id: pendingId });
}

export async function chooseAccounts(formData: FormData) {
  const pendingId = String(formData.get("pending_id") ?? "");
  const externalIds = formData.getAll("external_id").map(String);
  const result = await callConnections<{ message: string; return_to: string | null }>("/accounts/choose", { pending_id: pendingId, external_ids: externalIds });
  const jar = await cookies();
  if (result.ok) {
    if (result.data.message) jar.set(flashCookie("notice", result.data.message));
  } else {
    jar.set(flashCookie("error", result.error));
  }
  revalidatePath("/beta/accounts");
  // The return address was checked when the sign-in started; only its path and query are kept.
  let target = "/beta/accounts";
  if (result.ok && result.data.return_to) {
    try {
      const url = new URL(result.data.return_to);
      if (url.pathname.startsWith("/beta/")) target = `${url.pathname}${url.search}`;
    } catch {
      // keep the default
    }
  }
  redirect(`${target}${target.includes("?") ? "&" : "?"}${result.ok ? "message=connected" : "error=connect_failed"}`);
}
