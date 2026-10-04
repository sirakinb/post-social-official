// Session handling for the new InsForge-backed app under /beta. The current Convex app
// (/app, /login) is not touched by this proxy.
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@insforge/sdk/ssr/middleware";
import { BETA_HOME, BETA_LOGIN, isPublicBetaPath } from "@/lib/insforge/auth-rules";

export async function proxy(request: NextRequest) {
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

// Carries refreshed or cleared session cookies over to a redirect.
function withCookies(target: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

export const config = {
  matcher: ["/beta", "/beta/:path*"],
};
