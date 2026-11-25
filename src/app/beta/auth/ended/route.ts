// Where pages send a browser whose cookie no longer matches a session (our own sign-in
// only; see signedOutPath). Clears the cookie and goes on to the sign-in page. It checks
// the session itself first, so a link to this address can't sign anyone out.
import { NextResponse, type NextRequest } from "next/server";
import { BETA_LOGIN, safeNextPath } from "@/lib/insforge/auth-rules";
import { ownSession } from "@/lib/sign-in/ours";
import { ownSignInUrl, SESSION_COOKIE } from "@/lib/sign-in/rules";

export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const login = new URL(BETA_LOGIN, request.url);
  login.searchParams.set("next", next);
  if (!ownSignInUrl()) return NextResponse.redirect(login);

  const session = await ownSession();
  if (session.state === "signed-in") return NextResponse.redirect(new URL(next, request.url));
  if (session.state === "unknown") {
    // The API couldn't be asked. Keep the cookie: the person is probably still signed in.
    return new NextResponse("Post Social can't check your sign-in right now. Try again in a moment.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30", "Cache-Control": "no-store" } });
  }
  const response = NextResponse.redirect(login);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
