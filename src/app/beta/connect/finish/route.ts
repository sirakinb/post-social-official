import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";

// The end of connecting a social account. The platform sends the browser here (through
// the connections function's callback, or straight here for YouTube). The proxy makes sure
// someone is signed in; the connections function then finishes the sign-in only if they
// are the person who started it, so a sign-in link sent to someone else can't attach
// their account to the sender's workspace.
export async function GET(request: NextRequest) {
  const accounts = new URL("/beta/accounts", request.nextUrl.origin);
  const fail = (message: string) => {
    accounts.searchParams.set("error", message);
    return NextResponse.redirect(accounts, { headers: { "Referrer-Policy": "no-referrer" } });
  };

  const base = process.env.CONNECTIONS_BASE_URL;
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!base) return fail("Connections are not configured.");
  if (!token) return fail("Your session ended. Sign in and connect again.");

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
  const result = (await response?.json().catch(() => null)) as { ok?: boolean; returnTo?: string | null; message?: string; platform?: string; error?: string } | null;
  if (!response?.ok || !result) return fail(result?.error ?? "The connection could not be finished. Try again.");

  // returnTo was checked against the web app's addresses when the sign-in started.
  const target = new URL(result.returnTo ?? accounts.toString());
  if (result.ok) {
    target.searchParams.set("connected", result.platform ?? "");
    target.searchParams.set("message", result.message ?? "Connected.");
  } else {
    target.searchParams.set("error", result.message ?? "The connection could not be finished.");
  }
  return NextResponse.redirect(target, { headers: { "Referrer-Policy": "no-referrer" } });
}
