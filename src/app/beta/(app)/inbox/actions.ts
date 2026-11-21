"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { OUR_SIDE, UNREACHABLE, requestError } from "../../../../../backend/lib/support";

// Inbox changes go through the `api` function with the person's own session, so the same
// checks (no reviewers, Meta's reply windows) apply as for the API and MCP.
async function call<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = process.env.API_BASE_URL;
  if (!base) return { ok: false, error: OUR_SIDE };
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!token) return { ok: false, error: "Your session ended. Sign in again." };
  const response = await fetch(`${base}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, error: UNREACHABLE };
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) return { ok: false, error: requestError(response.status, data?.error?.message) };
  revalidatePath("/beta/inbox", "layout");
  return { ok: true, data: data as T };
}

export async function sendMessage(conversationId: string, text: string) {
  return call({ action: "send_message", conversation_id: conversationId, text });
}
export async function setConversationStatus(conversationId: string, status: "open" | "done" | "archived") {
  return call({ action: "update_conversation", conversation_id: conversationId, status });
}
export async function replyToComment(commentId: string, text: string) {
  return call({ action: "reply_to_comment", comment_id: commentId, text });
}
export async function dmCommenter(commentId: string, text: string) {
  return call({ action: "dm_commenter", comment_id: commentId, text });
}
export async function hideComment(commentId: string, hidden: boolean) {
  return call({ action: "hide_comment", comment_id: commentId, hidden });
}
export async function deleteComment(commentId: string) {
  return call({ action: "delete_comment", comment_id: commentId });
}
export async function updateContact(contactId: string, input: { email?: string | null; tags?: string[]; notes?: string | null }) {
  return call({ action: "update_contact", contact_id: contactId, ...input });
}
