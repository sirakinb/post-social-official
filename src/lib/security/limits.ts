import { headers } from "next/headers";
import { createTelemetry } from "../../../backend/lib/telemetry";
import { forwardingHeaders } from "./client-ip";

const telemetry = createTelemetry({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, service: "web", environment: process.env.VERCEL_ENV ?? "development" });

export type LimitAnswer = { blocked: string | null; send: boolean };
const GO_AHEAD: LimitAnswer = { blocked: null, send: true };

// Asks the API whether this sign-in or password reset may go ahead (limits per visitor and
// per email). `blocked` is a message to show; `send: false` means answer as usual but send
// no reset email. If the check can't be made, the request goes ahead (a limiter outage must
// not lock people out) and the failure is reported, so limits can't silently switch off.
export async function checkAuthLimit(check: "signin" | "reset_request" | "reset_complete", email: string): Promise<LimitAnswer> {
  const base = process.env.API_BASE_URL;
  if (!base) return GO_AHEAD;
  if (!process.env.INTERNAL_PROXY_SECRET) {
    if (process.env.VERCEL_ENV === "production") await telemetry.captureException(new Error("INTERNAL_PROXY_SECRET is not set: sign-in limits are off"), { area: "auth limits" });
    return GO_AHEAD;
  }
  const response = await fetch(`${base}/internal/limits`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...forwardingHeaders(await headers()) },
    body: JSON.stringify({ check, email }),
    cache: "no-store",
  }).catch(() => null);
  if (response?.status === 429) {
    const minutes = Math.max(1, Math.ceil(Number(response.headers.get("retry-after") ?? 60) / 60));
    return { blocked: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, send: true };
  }
  if (response?.ok) {
    const body = (await response.json().catch(() => null)) as { send?: boolean } | null;
    return { blocked: null, send: body?.send !== false };
  }
  await telemetry.captureException(new Error(`Auth limit check failed (${response ? response.status : "unreachable"}): limits skipped for this request`), { area: "auth limits", check });
  return GO_AHEAD;
}
