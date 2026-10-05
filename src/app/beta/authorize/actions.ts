"use server";

import { cookies } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";

export type AuthorizeParams = Record<string, string | undefined>;
export type ConsentCheck =
  | { ok: true; client_name: string; client_uri: string | null; redirect_host: string }
  | { ok: true; redirect: string }
  | { ok: false; error: string };

// The consent page asks the `api` function (with the person's session) to check the
// request and to record the decision, so the rules live in one place.
async function callConsent<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = process.env.API_BASE_URL;
  if (!base) return { ok: false, error: "Sign-in for apps is not configured." };
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!token) return { ok: false, error: "Your session ended. Sign in again." };
  const response = await fetch(`${base}/oauth/consent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, error: "Post Social could not be reached. Try again." };
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) return { ok: false, error: data?.error?.message ?? "Something went wrong. Try again." };
  return { ok: true, data: data as T };
}

const pick = (params: AuthorizeParams) => ({
  response_type: params.response_type,
  client_id: params.client_id,
  redirect_uri: params.redirect_uri,
  code_challenge: params.code_challenge,
  code_challenge_method: params.code_challenge_method,
  state: params.state,
  scope: params.scope,
  resource: params.resource,
});

export async function checkRequest(params: AuthorizeParams): Promise<ConsentCheck> {
  const result = await callConsent<{ client_name: string; client_uri: string | null; redirect_host: string } | { redirect: string }>({ action: "check", params: pick(params) });
  if (!result.ok) return result;
  return { ok: true, ...result.data };
}

export async function decide(params: AuthorizeParams, workspaceId: string, approve: boolean) {
  return callConsent<{ redirect: string }>({ action: "decide", params: pick(params), workspace_id: workspaceId, approve });
}
