import { headers } from "next/headers";
import { forwardingHeaders } from "./client-ip";

// Asks the API whether this sign-in or password reset may go ahead (limits per visitor and
// per email). Returns a message to show when it may not. If the check can't be made, the
// request goes ahead: an outage of the limiter must not lock people out.
export async function checkAuthLimit(check: "signin" | "reset_request" | "reset_complete", email: string): Promise<string | null> {
  const base = process.env.API_BASE_URL;
  if (!base || !process.env.INTERNAL_PROXY_SECRET) return null;
  const response = await fetch(`${base}/internal/limits`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...forwardingHeaders(await headers()) },
    body: JSON.stringify({ check, email }),
    cache: "no-store",
  }).catch(() => null);
  if (response?.status !== 429) return null;
  const wait = Number(response.headers.get("retry-after") ?? 60);
  const minutes = Math.max(1, Math.ceil(wait / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
