// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, { value: string; options?: Record<string, unknown> }>(), headers: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => void jar.cookies.set(name, { value, options }),
    delete: (name: string) => void jar.cookies.delete(name),
  }),
  headers: async () => new Headers([...jar.headers]),
}));

import { ownCurrentUser, ownSession, resetPassword, sendResetCode, sendVerificationCode, signInWithPassword, signOut, signUp, verifyEmail } from "./ours";

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };
const calls: Call[] = [];
let answers: Array<{ status: number; body?: unknown; token?: string } | "down"> = [];

beforeEach(() => {
  calls.length = 0;
  answers = [];
  jar.cookies.clear();
  jar.headers.clear();
  jar.headers.set("x-real-ip", "203.0.113.9");
  vi.stubEnv("SIGN_IN_URL", "https://api.postsocial.test/auth");
  vi.stubEnv("INTERNAL_PROXY_SECRET", "website-secret");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body: init.body ? JSON.parse(String(init.body)) : null });
    const next = answers.shift() ?? { status: 200, body: {} };
    if (next === "down") throw new Error("connect ECONNREFUSED");
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: next.token ? { "set-auth-token": next.token } : {} });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the website's side of our own sign-in", () => {
  it("signs in through the API with the website's secret, and keeps the session where scripts can't read it", async () => {
    answers = [{ status: 200, body: { user: { id: "u1" } }, token: "signed.token" }];
    expect(await signInWithPassword("ada@example.com", "a-good-password-1")).toEqual({ signedIn: true, error: null });
    expect(calls[0]).toMatchObject({ url: "https://api.postsocial.test/auth/sign-in/email", method: "POST", body: { email: "ada@example.com", password: "a-good-password-1" } });
    expect(calls[0].headers).toMatchObject({ "x-ps-proxy-secret": "website-secret", "x-ps-client-ip": "203.0.113.9" });
    expect(jar.cookies.get("ps_session")).toEqual({ value: "signed.token", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2592000 } });
  });

  it("passes on why a sign-in was turned away, and remembers nothing", async () => {
    answers = [{ status: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } }, { status: 403, body: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" } }, "down"];
    expect(await signInWithPassword("ada@example.com", "wrong-password-1")).toEqual({ signedIn: false, error: { statusCode: 401, error: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } });
    expect((await signInWithPassword("ada@example.com", "a-good-password-1")).error).toMatchObject({ statusCode: 403, message: "Email not verified" });
    // The API not answering reads as the service being down, never as a wrong password.
    expect((await signInWithPassword("ada@example.com", "a-good-password-1")).error).toMatchObject({ statusCode: 503 });
    expect(jar.cookies.size).toBe(0);
  });

  it("can't reach sign-in at all without the website's secret", async () => {
    vi.stubEnv("INTERNAL_PROXY_SECRET", "");
    expect((await signInWithPassword("ada@example.com", "a-good-password-1")).error).toMatchObject({ statusCode: 503 });
    expect(calls).toHaveLength(0);
  });

  it("signs up, asks for the emailed code, and signs in once the code is right", async () => {
    answers = [{ status: 200, body: { token: null } }, { status: 200, body: { success: true } }, { status: 400, body: { code: "INVALID_OTP" } }, { status: 200, body: { status: true }, token: "signed.after.code" }];
    expect(await signUp("ada@example.com", "a-good-password-1", "Ada")).toEqual({ error: null });
    expect(calls[0]).toMatchObject({ url: "https://api.postsocial.test/auth/sign-up/email", body: { email: "ada@example.com", password: "a-good-password-1", name: "Ada" } });
    expect(jar.cookies.size).toBe(0);

    expect(await sendVerificationCode("ada@example.com")).toEqual({ error: null });
    expect(calls[1]).toMatchObject({ url: "https://api.postsocial.test/auth/email-otp/send-verification-otp", body: { email: "ada@example.com", type: "email-verification" } });

    expect(await verifyEmail("ada@example.com", "000000")).toMatchObject({ signedIn: false, error: { statusCode: 400 } });
    expect(await verifyEmail("ada@example.com", "482913")).toEqual({ signedIn: true, error: null });
    expect(calls[3].body).toEqual({ email: "ada@example.com", otp: "482913" });
    expect(jar.cookies.get("ps_session")?.value).toBe("signed.after.code");
  });

  it("resets a password by code and says whether the code was the problem", async () => {
    answers = [{ status: 200, body: { success: true } }, { status: 400, body: { code: "INVALID_OTP" } }, { status: 500 }, { status: 400, body: { code: "PASSWORD_TOO_WEAK" } }, { status: 200, body: { success: true } }];
    expect(await sendResetCode("ada@example.com")).toEqual({ error: null });
    expect(calls[0].url).toBe("https://api.postsocial.test/auth/email-otp/request-password-reset");
    expect(await resetPassword("ada@example.com", "000000", "a-new-password-22")).toMatchObject({ wrongCode: true, error: { statusCode: 400 } });
    expect(await resetPassword("ada@example.com", "482913", "a-new-password-22")).toMatchObject({ wrongCode: false, error: { statusCode: 500 } });
    expect(await resetPassword("ada@example.com", "482913", "weak")).toMatchObject({ wrongCode: false });
    expect(await resetPassword("ada@example.com", "482913", "a-new-password-22")).toEqual({ wrongCode: false, error: null });
    expect(calls[4].body).toEqual({ email: "ada@example.com", otp: "482913", password: "a-new-password-22" });
  });

  it("knows who is signed in from the cookie's token, sent as a bearer token", async () => {
    expect(await ownCurrentUser()).toBeNull();
    expect(calls).toHaveLength(0);

    jar.cookies.set("ps_session", { value: "signed.token" });
    answers = [{ status: 200, body: { user: { id: "u1", email: "ada@example.com", name: "Ada", image: null }, session: {} } }];
    expect(await ownCurrentUser()).toEqual({ id: "u1", email: "ada@example.com", name: "Ada", image: null });
    expect(calls[0]).toMatchObject({ url: "https://api.postsocial.test/auth/get-session", method: "GET", body: null });
    expect(calls[0].headers.authorization).toBe("Bearer signed.token");
  });

  it("tells an ended session from an API it couldn't ask", async () => {
    jar.cookies.set("ps_session", { value: "signed.token" });
    // The API answers "no session" with an empty body.
    answers = [{ status: 200, body: null }, { status: 401, body: {} }, { status: 503 }, "down", { status: 404 }];
    expect(await ownSession()).toEqual({ state: "ended" });
    expect(await ownSession()).toEqual({ state: "ended" });
    expect(await ownSession()).toEqual({ state: "unknown" });
    expect(await ownSession()).toEqual({ state: "unknown" });
    // A wrong secret or address answers "not found": that isn't the person's session ending.
    expect(await ownSession()).toEqual({ state: "unknown" });
  });

  it("signs out on the API and forgets the cookie, even if the API doesn't answer", async () => {
    jar.cookies.set("ps_session", { value: "signed.token" });
    answers = ["down"];
    await signOut();
    expect(calls[0]).toMatchObject({ url: "https://api.postsocial.test/auth/sign-out", method: "POST" });
    expect(calls[0].headers.authorization).toBe("Bearer signed.token");
    expect(jar.cookies.has("ps_session")).toBe(false);
  });
});
