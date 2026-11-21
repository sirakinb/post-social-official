"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { OUR_SIDE, UNREACHABLE, requestError } from "../../../../../../backend/lib/support";

export type AutomationInput = {
  account_id?: string;
  name: string;
  platform_post_id: string | null;
  keywords: string[];
  match_mode: "word" | "contains" | "exact";
  exclude_keywords: string[];
  dm_message: string;
  dm_buttons: Array<{ label: string; url: string }>;
  comment_reply: string | null;
  repeat_mode: "once" | "every_comment";
  is_active: boolean;
};

// Automations are changed through the `api` function with the person's own session, so the
// same checks (no reviewers) and audit trail apply as for the API and MCP.
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
  revalidatePath("/beta/inbox/automations");
  return { ok: true, data: data as T };
}

export async function createAutomation(workspaceId: string, input: AutomationInput) {
  return call<{ automation: { id: string } }>({ action: "create_automation", workspace_id: workspaceId, ...input });
}

export async function updateAutomation(automationId: string, input: Partial<AutomationInput>) {
  return call<{ automation: { id: string } }>({ action: "update_automation", automation_id: automationId, ...input });
}

export async function deleteAutomation(automationId: string) {
  return call<{ deleted: boolean }>({ action: "delete_automation", automation_id: automationId });
}

export async function automationPosts(workspaceId: string, accountId: string) {
  return call<{ posts: Array<{ platform_post_id: string; caption: string | null; published_at: string }> }>({ action: "automation_posts", workspace_id: workspaceId, account_id: accountId });
}
