import { NextRequest, NextResponse } from "next/server";

// Google's registered redirect URI points at this app domain
// (https://www.postsocial.xyz/api/auth/youtube/callback). The OAuth completion
// lives with the other platform callbacks on the Convex HTTP router, so this
// route only forwards Google's query parameters there.
export async function GET(request: NextRequest) {
  const convexSite = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!convexSite) {
    return NextResponse.redirect(
      new URL(`/app/accounts?error=${encodeURIComponent("The YouTube connection is not configured.")}`, request.nextUrl.origin)
    );
  }
  const target = new URL("/api/oauth/youtube/callback", convexSite);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  return NextResponse.redirect(target);
}
