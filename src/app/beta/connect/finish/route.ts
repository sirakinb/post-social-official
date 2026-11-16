import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { requestError } from "../../../../../backend/lib/support";
import { flashCookie, type AccountErrorCode } from "@/lib/beta/flash";

// The end of connecting a social account. The platform sends the browser here (through
// the connections function's callback, or straight here for YouTube). The proxy makes sure
// someone is signed in; the connections function then finishes the sign-in only if they
// are the person who started it, so a sign-in link sent to someone else can't attach
// their account to the sender's workspace.
export async function GET(request: NextRequest) {
  const accounts = new URL("/beta/accounts", request.nextUrl.origin);
  // The address carries only a code; a message from our server goes in a short-lived cookie.
  const send = (target: URL, flash?: { kind: "error" | "notice"; text: string }) => {
    const response = NextResponse.redirect(target, { headers: { "Referrer-Policy": "no-referrer" } });
    if (flash) response.cookies.set(flashCookie(flash.kind, flash.text));
    return response;
  };
  const fail = (code: AccountErrorCode, text?: string) => {
    accounts.searchParams.set("error", code);
    return send(accounts, text ? { kind: "error", text } : undefined);
  };

  const base = process.env.CONNECTIONS_BASE_URL;
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!base) return fail("our_side");
  if (!token) return fail("session_ended");

  const query = request.nextUrl.searchParams;
  const params: Record<string, string> = {};
  query.forEach((value, key) => {
    if (key !== "platform") params[key] = value;
  });
  const response = await fetch(`${base}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ platform: query.get("platform"), params }),
    cache: "no-store",
  }).catch(() => null);
  const result = (await response?.json().catch(() => null)) as { ok?: boolean; returnTo?: string | null; message?: string; platform?: string; error?: string; choose?: string } | null;
  if (!response) return fail("unreachable");
  if (!response.ok || !result) return fail("connect_failed", requestError(response.status, result?.error));

  // returnTo was checked against the web app's addresses when the sign-in started.
  const target = new URL(result.returnTo ?? accounts.toString());
  // Several new accounts came back (a LinkedIn profile and Pages): the person picks which.
  if (result.ok && result.choose && /^[0-9a-f-]{36}$/i.test(result.choose)) {
    const choose = new URL("/beta/accounts/choose", request.nextUrl.origin);
    choose.searchParams.set("pending", result.choose);
    const workspace = target.searchParams.get("workspace");
    if (workspace) choose.searchParams.set("workspace", workspace);
    return send(choose, result.message ? { kind: "notice", text: result.message } : undefined);
  }
  if (result.ok) {
    target.searchParams.set("connected", result.platform ?? "");
    target.searchParams.set("message", "connected");
    return send(target, result.message ? { kind: "notice", text: result.message } : undefined);
  }
  target.searchParams.set("error", "connect_failed");
  return send(target, result.message ? { kind: "error", text: result.message } : undefined);
}
