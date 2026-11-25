// The website's side of our own sign-in (backend/lib/auth, on our API). Server only.
//
// Every call goes from this server to the API with the website's shared secret, which is
// the only thing the API's sign-in routes answer to; the browser never talks to them. A
// successful sign-in comes back with a session token, kept in an httpOnly cookie on this
// site and sent to the API as a bearer token from then on.
import { cookies, headers } from "next/headers";
import { visitorIp } from "@/lib/security/client-ip";
import { ownSignInUrl, SESSION_COOKIE, sessionCookieOptions } from "./rules";

export type AuthError = { statusCode?: number; error?: string; message?: string };
export type OwnUser = { id: string; email: string; name: string | null; image: string | null };
type Answer = { status: number; body: Record<string, unknown> | null; token: string | null };

// The API didn't answer: the forms word this as "not responding".
const UNREACHABLE: Answer = { status: 503, body: null, token: null };

async function call(method: "GET" | "POST", path: string, body?: Record<string, unknown>, token?: string | null): Promise<Answer> {
  const base = ownSignInUrl();
  const secret = process.env.INTERNAL_PROXY_SECRET;
  if (!base || !secret) return UNREACHABLE;
  const ip = visitorIp(await headers());
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-PS-Proxy-Secret": secret,
      ...(ip ? { "X-PS-Client-IP": ip } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response) return UNREACHABLE;
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null, token: response.headers.get("set-auth-token") };
}

const failure = (answer: Answer): AuthError => ({
  statusCode: answer.status,
  error: typeof answer.body?.code === "string" ? answer.body.code : undefined,
  message: typeof answer.body?.message === "string" ? answer.body.message : undefined,
});
const worked = (answer: Answer) => answer.status >= 200 && answer.status < 300;

async function remember(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function ownSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value || null;
}

export async function signInWithPassword(email: string, password: string): Promise<{ signedIn: boolean; error: AuthError | null }> {
  const answer = await call("POST", "/sign-in/email", { email, password });
  if (!worked(answer) || !answer.token) return { signedIn: false, error: failure(worked(answer) ? { ...answer, status: 502 } : answer) };
  await remember(answer.token);
  return { signedIn: true, error: null };
}

// Signing up never signs anyone in: the emailed code comes first.
export async function signUp(email: string, password: string, name: string): Promise<{ error: AuthError | null }> {
  const answer = await call("POST", "/sign-up/email", { email, password, name });
  return { error: worked(answer) ? null : failure(answer) };
}

export async function sendVerificationCode(email: string): Promise<{ error: AuthError | null }> {
  const answer = await call("POST", "/email-otp/send-verification-otp", { email, type: "email-verification" });
  return { error: worked(answer) ? null : failure(answer) };
}

// A right code confirms the email and signs the person in.
export async function verifyEmail(email: string, code: string): Promise<{ signedIn: boolean; error: AuthError | null }> {
  const answer = await call("POST", "/email-otp/verify-email", { email, otp: code });
  if (!worked(answer)) return { signedIn: false, error: failure(answer) };
  if (!answer.token) return { signedIn: false, error: null };
  await remember(answer.token);
  return { signedIn: true, error: null };
}

export async function sendResetCode(email: string): Promise<{ error: AuthError | null }> {
  const answer = await call("POST", "/email-otp/request-password-reset", { email });
  return { error: worked(answer) ? null : failure(answer) };
}

// `wrongCode`: the code was the problem (a typo, expired, used up), not the service.
export async function resetPassword(email: string, code: string, newPassword: string): Promise<{ wrongCode: boolean; error: AuthError | null }> {
  const answer = await call("POST", "/email-otp/reset-password", { email, otp: code, password: newPassword });
  if (worked(answer)) return { wrongCode: false, error: null };
  const error = failure(answer);
  return { wrongCode: answer.status >= 400 && answer.status < 500 && answer.status !== 429 && error.error !== "PASSWORD_TOO_WEAK", error };
}

// Ends the session on the API (best effort) and forgets it here.
export async function signOut() {
  const token = await ownSessionToken();
  if (token) await call("POST", "/sign-out", {}, token);
  (await cookies()).delete(SESSION_COOKIE);
}

// Whose session the cookie holds. "ended" means the API said there is none (signed out
// elsewhere, expired, password reset); "unknown" means the API couldn't be asked, which is
// never a reason to sign anyone out.
export type OwnSession = { state: "signed-in"; user: OwnUser } | { state: "ended" } | { state: "unknown" };

export async function ownSession(): Promise<OwnSession> {
  const token = await ownSessionToken();
  if (!token) return { state: "ended" };
  const answer = await call("GET", "/get-session", undefined, token);
  if (!worked(answer)) return { state: answer.status === 401 ? "ended" : "unknown" };
  const user = answer.body?.user as { id?: unknown; email?: unknown; name?: unknown; image?: unknown } | undefined;
  if (typeof user?.id !== "string" || typeof user.email !== "string") return { state: "ended" };
  return { state: "signed-in", user: { id: user.id, email: user.email, name: typeof user.name === "string" && user.name ? user.name : null, image: typeof user.image === "string" && user.image ? user.image : null } };
}

// Who is signed in, or null when nobody is (or it can't be checked right now).
export async function ownCurrentUser(): Promise<OwnUser | null> {
  const session = await ownSession();
  return session.state === "signed-in" ? session.user : null;
}
