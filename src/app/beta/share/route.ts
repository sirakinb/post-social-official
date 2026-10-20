import { NextResponse, type NextRequest } from "next/server";

// Where the share sheet sends photos and videos shared to the installed app (manifest
// share_target). The service worker (public/sw.js) normally answers this on the phone, so a
// request only reaches the server if the worker wasn't installed yet; the files can't come
// through the server (too large), so Create explains and offers the upload button instead.
export function POST(request: NextRequest) {
  return NextResponse.redirect(new URL("/beta/create?shared=failed", request.nextUrl.origin), 303);
}

export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/beta/create", request.nextUrl.origin), 303);
}
