// Which sign-in the website uses, and how it remembers a signed-in browser. No framework
// imports, so the proxy, the server actions and tests can all use it.
//
// Today that is InsForge. When SIGN_IN_URL is set (per environment, in Vercel), it is our
// own API instead (backend/lib/auth), e.g. https://api.postsocial.xyz/auth. The same
// environment must then point API_BASE_URL, CONNECTIONS_BASE_URL and FUNCTIONS_BASE_URL at
// that API too, because the session it hands out is only good there.
import { trimTrailingSlashes } from "../../../backend/lib/text";

type Env = Record<string, string | undefined>;

// Our own API's sign-in address, or null while sign-in is InsForge's.
export function ownSignInUrl(env: Env = process.env): string | null {
  const url = trimTrailingSlashes((env.SIGN_IN_URL ?? "").trim());
  return /^https?:\/\/[^\s/]+\/\S*$/.test(url) ? url : null;
}

// Where the `posts` and `media` functions answer: InsForge's function addresses, or the
// same paths on our own API.
export function functionsBaseUrl(env: Env = process.env): string {
  const own = trimTrailingSlashes((env.FUNCTIONS_BASE_URL ?? "").trim());
  return own || `${trimTrailingSlashes(env.NEXT_PUBLIC_INSFORGE_URL ?? "")}/functions`;
}

// With our own sign-in the browser holds one cookie: the session token, which page scripts
// can't read. It lasts as long as the session does on the API (backend/lib/auth/auth.ts),
// and both are pushed out again while the person keeps using the app.
export const SESSION_COOKIE = "ps_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

export function sessionCookieOptions(env: Env = process.env) {
  return { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_SECONDS };
}

// Where a page sends someone whose cookie no longer matches a session, so the cookie can
// be cleared (a page can't clear it itself) before they reach the sign-in page.
export const SESSION_ENDED = "/beta/auth/ended";
