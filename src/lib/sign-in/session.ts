// The signed-in person's session token, wherever sign-in lives (see ./rules.ts). Server
// actions and route handlers send it to our backend as a bearer token.
import { cookies } from "next/headers";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { ownSignInUrl, SESSION_COOKIE, SESSION_ENDED } from "./rules";

export async function sessionToken(): Promise<string | undefined> {
  const name = ownSignInUrl() ? SESSION_COOKIE : getAccessTokenCookieName();
  return (await cookies()).get(name)?.value || undefined;
}

// Where a page sends a visitor it found nobody signed in for, to come back to `next` after.
// With our own sign-in, a browser can still hold the cookie of a session that has ended;
// it goes by SESSION_ENDED first, which clears the cookie (a page can't), so the sign-in
// page doesn't take it for a signed-in person and send them straight back.
export async function signedOutPath(next: string): Promise<string> {
  const target = ownSignInUrl() && (await sessionToken()) ? SESSION_ENDED : BETA_LOGIN;
  return `${target}?next=${encodeURIComponent(next)}`;
}
