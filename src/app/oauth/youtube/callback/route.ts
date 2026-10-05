import { NextResponse, type NextRequest } from "next/server";

// Google only accepts sign-in callbacks on domains we own, so YouTube's registered callback
// is this page (www.postsocial.xyz in prod, localhost on dev). It hands Google's answer to
// /beta/connect/finish, which finishes it as the signed-in person who started it.
export function GET(request: NextRequest) {
  const finish = new URL("/beta/connect/finish", request.nextUrl.origin);
  finish.searchParams.set("platform", "youtube");
  request.nextUrl.searchParams.forEach((value, key) => finish.searchParams.set(key, value));
  return NextResponse.redirect(finish, { headers: { "Referrer-Policy": "no-referrer" } });
}
