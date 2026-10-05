"use server";

import { cookies } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { callServer } from "@/lib/beta/workspace";
import type { CreatorInfo } from "../../../../../backend/lib/connections/tiktok-creator";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// The composer uses the same `posts` function as AIs (validate, create, update, submit),
// with the person's own session, so it gets exactly the same checks and audit trail.
const ACTIONS = new Set(["validate", "create", "update", "submit", "get", "reschedule", "cancel"]);

export async function callPosts<T = Record<string, unknown>>(action: string, input: Record<string, unknown>): Promise<Result<T>> {
  if (!ACTIONS.has(action)) return { ok: false, error: "That action is not available." };
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!token) return { ok: false, error: "Your session ended. Sign in again." };
  const response = await fetch(`${process.env.NEXT_PUBLIC_INSFORGE_URL}/functions/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...input }),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, error: "Post Social could not be reached. Try again." };
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) return { ok: false, error: body?.error ?? "Something went wrong. Try again." };
  return { ok: true, data: body as T };
}

export async function getCreatorInfo(accountId: string): Promise<Result<CreatorInfo>> {
  const data = await callServer<CreatorInfo>("tiktok_creator_info", { account_id: accountId });
  return data ? { ok: true, data } : { ok: false, error: "TikTok didn't return this account's settings. Try again in a moment." };
}

export async function getMediaLinks(workspaceId: string, mediaIds: string[]): Promise<Record<string, string>> {
  if (!mediaIds.length) return {};
  return (await callServer<{ links: Record<string, string> }>("media_links", { workspace_id: workspaceId, media_ids: mediaIds }))?.links ?? {};
}
