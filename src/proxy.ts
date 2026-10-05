// Session handling for the new InsForge-backed app under /beta, and the visitor's address
// for requests this site forwards to the API (rate limits). The current Convex app (/app,
// /login) is not touched by this proxy.
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@insforge/sdk/ssr/middleware";
import { BETA_HOME, BETA_LOGIN, isPublicBetaPath } from "@/lib/insforge/auth-rules";
import { forwardingHeaders } from "@/lib/security/client-ip";

// Paths this site forwards to the API function (next.config.ts rewrites).
const API_PATHS = /^\/(api\/v1(\/|$)|mcp$|oauth\/(register|token|revoke)$|\.well-known\/oauth-)/;

export async function proxy(request: NextRequest) {
  if (API_PATHS.test(request.nextUrl.pathname)) return forwardVisitorAddress(request);
  if (!/^\/beta(\/|$)/.test(request.nextUrl.pathname)) return NextResponse.next();
  const response = NextResponse.next({ request });
  // Refreshes the access token before pages render, and clears cookies for a dead session.
  const { accessToken } = await updateSession({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  const { pathname, search } = request.nextUrl;
  const isPublic = isPublicBetaPath(pathname);

  if (!accessToken && !isPublic) {
    const login = new URL(BETA_LOGIN, request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return withCookies(NextResponse.redirect(login), response);
  }
  if (accessToken && pathname.replace(/\/+$/, "") === BETA_LOGIN) {
    return withCookies(NextResponse.redirect(new URL(BETA_HOME, request.url)), response);
  }
  return response;
}

// Requests forwarded to the API reach it from Vercel's address. Tell it the visitor's real
// address (for per-visitor rate limits), with the shared secret that makes it believable.
// Whatever a caller sent in these headers is replaced.
function forwardVisitorAddress(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-ps-client-ip");
  requestHeaders.delete("x-ps-proxy-secret");
  for (const [name, value] of Object.entries(forwardingHeaders(request.headers))) requestHeaders.set(name, value);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Carries refreshed or cleared session cookies over to a redirect.
function withCookies(target: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

export const config = {
  matcher: ["/beta", "/beta/:path*", "/api/v1/:path*", "/mcp", "/oauth/register", "/oauth/token", "/oauth/revoke",
    "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/:path*",
    "/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/:path*"],
};
