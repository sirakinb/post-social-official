import { NextResponse, type NextRequest } from "next/server";

// Google only accepts sign-in callbacks on domains we own, so YouTube's registered callback
// is this page (www.postsocial.xyz in prod, localhost on dev). It forwards Google's query
// to the `connections` function, which finishes the sign-in like every other platform.
export function GET(request: NextRequest) {
  const base = process.env.CONNECTIONS_BASE_URL;
  if (!base) {
    return NextResponse.redirect(new URL("/beta/accounts?error=YouTube+connections+are+not+configured.", request.nextUrl.origin));
  }
  const target = new URL(`${base}/oauth/youtube/callback`);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  return NextResponse.redirect(target);
}
