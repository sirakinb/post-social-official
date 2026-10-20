"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { OUR_SIDE, UNREACHABLE, requestError } from "../../../../../backend/lib/support";

// Billing changes go through the `api` function with the person's own session, so only
// owners and admins can add a card, open Stripe's portal or change the X cap.
async function callBilling<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
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
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } | string }) | null;
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : data?.error?.message;
    return { ok: false, error: requestError(response.status, message) };
  }
  return { ok: true, data: data as T };
}

const back = (error: string) => redirect(`/beta/billing?error=${encodeURIComponent(error)}`);

// Stripe's own pages only: we never see card details.
function stripeUrl(url: unknown) {
  return typeof url === "string" && /^https:\/\/(checkout|billing)\.stripe\.com\//.test(url) ? url : null;
}

export async function addCard(formData: FormData) {
  const result = await callBilling<{ url: string }>({ action: "billing_checkout", workspace_id: formData.get("workspace_id") });
  if (!result.ok) back(result.error);
  const url = result.ok ? stripeUrl(result.data.url) : null;
  if (!url) back(OUR_SIDE);
  redirect(url!);
}

export async function manageBilling(formData: FormData) {
  const result = await callBilling<{ url: string }>({ action: "billing_portal", workspace_id: formData.get("workspace_id") });
  if (!result.ok) back(result.error);
  const url = result.ok ? stripeUrl(result.data.url) : null;
  if (!url) back(OUR_SIDE);
  redirect(url!);
}

export async function saveXCap(formData: FormData) {
  const result = await callBilling<{ monthly_cap: number }>({ action: "billing_x_cap", workspace_id: formData.get("workspace_id"), monthly_cap: formData.get("monthly_cap") });
  if (!result.ok) back(result.error);
  revalidatePath("/beta/billing");
  redirect("/beta/billing?saved=x_cap");
}
