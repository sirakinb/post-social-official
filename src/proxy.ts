// Session handling for the web app under /beta, the visitor's address for requests this site
// forwards to the API (rate limits), DataFast's tracking of crawler visits to public pages, and
// Markdown for agents that ask for it on public pages (Accept: text/markdown).
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { trackAICrawlerRequest } from "@datafast/ai-crawl";
import { updateSession } from "@insforge/sdk/ssr/middleware";
import { BETA_HOME, BETA_LOGIN, SIGNED_OUT_ONLY_PATHS, isPublicBetaPath } from "@/lib/insforge/auth-rules";
import { botTrackingConfig } from "@/lib/analytics/bot-tracking";
import { forwardingHeaders } from "@/lib/security/client-ip";
import { markdownPath, publicPath, wantsMarkdown } from "@/lib/public-pages";

// Paths this site forwards to the API function (next.config.ts rewrites).
const API_PATHS = /^\/(api\/v1(\/|$)|mcp$|oauth\/(register|token|revoke)$|\.well-known\/oauth-)/;

export async function proxy(request: NextRequest, event?: NextFetchEvent) {
  // Not awaited: it reports in the background and must never slow a page down.
  trackAICrawlerRequest(request, event, botTrackingConfig());
  if (API_PATHS.test(request.nextUrl.pathname)) return forwardVisitorAddress(request);
  const page = publicPath(request.nextUrl.pathname);
  if (page && (request.method === "GET" || request.method === "HEAD")) return negotiateMarkdown(request, page);
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
  if (accessToken && (SIGNED_OUT_ONLY_PATHS as readonly string[]).includes(pathname.replace(/\/+$/, ""))) {
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

// Public pages answer in the format asked for: Markdown for an agent that prefers it, the
// normal page otherwise. Vary: Accept keeps caches from handing one format to the other.
function negotiateMarkdown(request: NextRequest, page: string) {
  if (wantsMarkdown(request.headers.get("accept"))) {
    const target = request.nextUrl.clone();
    target.pathname = markdownPath(page);
    return NextResponse.rewrite(target, { headers: { Vary: "Accept" } });
  }
  return NextResponse.next({ headers: { Vary: "Accept" } });
}

// Carries refreshed or cleared session cookies over to a redirect.
function withCookies(target: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

// Runs on every page, so crawler visits to public pages (and to robots.txt, llms.txt and the
// sitemap) can be seen; images, scripts and other static files are skipped.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|webp|svg|ico|css|js|woff2?|mp4|vtt|webmanifest)$).*)"],
};
