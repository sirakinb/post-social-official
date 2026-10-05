import { NextResponse, type NextRequest } from "next/server";

// The OAuth authorization endpoint AI apps open. The consent page lives under /beta so it
// shares the sign-in session; this forwards the request there unchanged.
export function GET(request: NextRequest) {
  const target = new URL("/beta/authorize", request.nextUrl.origin);
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target);
}
