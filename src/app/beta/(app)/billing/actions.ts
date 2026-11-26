"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sessionToken } from "@/lib/sign-in/session";
import { OUR_SIDE, UNREACHABLE, requestError } from "../../../../../backend/lib/support";
import { flashCookie, type BillingErrorCode } from "@/lib/beta/flash";

const SESSION_ENDED = "Your session ended. Sign in again.";

// Billing changes go through the `api` function with the person's own session, so only
// owners and admins can add a card, open Stripe's portal or change the X cap.
async function callBilling<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = process.env.API_BASE_URL;
  if (!base) return { ok: false, error: OUR_SIDE };
  const token = await sessionToken();
  if (!token) return { ok: false, error: SESSION_ENDED };
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

// This copy of the app's own address, so Stripe sends the person back here.
async function ownOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : undefined;
}

// Back to the Billing page with a short code; our server's own message rides in a short-lived
// cookie, so the address never carries text that the page would show as a notice.
async function back(error: string): Promise<never> {
  const code: BillingErrorCode = error === OUR_SIDE ? "our_side" : error === UNREACHABLE ? "unreachable" : error === SESSION_ENDED ? "session_ended" : "billing_failed";
  if (code === "billing_failed") (await cookies()).set(flashCookie("error", error));
  redirect(`/beta/billing?error=${code}`);
}

// Stripe's own pages only: we never see card details.
function stripeUrl(url: unknown) {
  return typeof url === "string" && /^https:\/\/(checkout|billing)\.stripe\.com\//.test(url) ? url : null;
}

// The visitor's DataFast cookies, so the payment is credited to the channel they arrived from.
async function datafastIds() {
  const jar = await cookies();
  return { datafast_visitor_id: jar.get("datafast_visitor_id")?.value, datafast_session_id: jar.get("datafast_session_id")?.value };
}

export async function addCard(formData: FormData) {
  // Rewardful adds a hidden "referral" field to the form for visitors who came through an
  // affiliate's link. The server drops anything that isn't a valid referral id.
  const referral = formData.get("referral");
  const result = await callBilling<{ url: string }>({ action: "billing_checkout", workspace_id: formData.get("workspace_id"), return_origin: await ownOrigin(), referral: typeof referral === "string" ? referral : undefined, ...(await datafastIds()) });
  if (!result.ok) await back(result.error);
  const url = result.ok ? stripeUrl(result.data.url) : null;
  if (!url) await back(OUR_SIDE);
  redirect(url!);
}

export async function manageBilling(formData: FormData) {
  const result = await callBilling<{ url: string }>({ action: "billing_portal", workspace_id: formData.get("workspace_id"), return_origin: await ownOrigin() });
  if (!result.ok) await back(result.error);
  const url = result.ok ? stripeUrl(result.data.url) : null;
  if (!url) await back(OUR_SIDE);
  redirect(url!);
}

export async function saveXCap(formData: FormData) {
  const result = await callBilling<{ monthly_cap: number }>({ action: "billing_x_cap", workspace_id: formData.get("workspace_id"), monthly_cap: formData.get("monthly_cap") });
  if (!result.ok) await back(result.error);
  revalidatePath("/beta/billing");
  redirect("/beta/billing?saved=x_cap");
}
