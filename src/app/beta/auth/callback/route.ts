// Google sends people back here after they sign in. Swaps the one-time code (plus the PKCE
// verifier from the cookie startGoogleSignIn set) for a session, then opens the app, which
// creates a workspace for first-time visitors.
import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";
import { BETA_LOGIN, OAUTH_CALLBACK, OAUTH_VERIFIER_COOKIE, safeNextPath } from "@/lib/insforge/auth-rules";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("insforge_code");
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  const failed = NextResponse.redirect(new URL(`${BETA_LOGIN}?error=google`, request.url));
  failed.cookies.delete({ name: OAUTH_VERIFIER_COOKIE, path: OAUTH_CALLBACK });
  if (!code || !verifier) return failed;

  const done = NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), request.url));
  const auth = createAuthActions({ requestCookies: request.cookies, responseCookies: done.cookies });
  const { data, error } = await auth.exchangeOAuthCode(code, verifier);
  if (error || !data?.user) return failed;
  done.cookies.delete({ name: OAUTH_VERIFIER_COOKIE, path: OAUTH_CALLBACK });
  return done;
}
