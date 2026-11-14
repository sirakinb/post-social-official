import { NextResponse } from "next/server";

// Platform sign-in callbacks registered on our own domain (www.postsocial.xyz in prod,
// localhost on dev) instead of on the backend's host, so the backend can move without a
// new platform review. Each one hands the platform's answer to /beta/connect/finish, which
// finishes it as the signed-in person who started it.
export function finishRedirect(url: URL, platform: string) {
  const finish = new URL("/beta/connect/finish", url.origin);
  url.searchParams.forEach((value, key) => finish.searchParams.set(key, value));
  finish.searchParams.set("platform", platform);
  return NextResponse.redirect(finish, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
