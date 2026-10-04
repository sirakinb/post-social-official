"use server";

import { cookies } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";

// The web app uses the same `media` function an AI client will, with the person's own
// session, so it gets exactly the same checks, limits and audit trail.
const ACTIONS = new Set(["create_upload", "complete_upload", "abort_upload", "import", "rename", "set_hidden", "get"]);

export type MediaResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string };

export async function callMedia<T = Record<string, unknown>>(payload: { action: string } & Record<string, unknown>): Promise<MediaResult<T>> {
  if (!ACTIONS.has(payload.action)) return { ok: false, error: "That media action is not available." };
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!token) return { ok: false, error: "Your session ended. Sign in again." };

  const response = await fetch(`${process.env.NEXT_PUBLIC_INSFORGE_URL}/functions/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, error: "The media service could not be reached. Try again." };

  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) return { ok: false, error: body?.error ?? "Something went wrong. Try again." };
  return { ok: true, data: body as T };
}
