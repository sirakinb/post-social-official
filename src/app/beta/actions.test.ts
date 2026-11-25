// @vitest-environment node
//
// The sign-in actions with our own sign-in switched on (SIGN_IN_URL). The forms, limits and
// messages are the same as with InsForge; what differs is who is asked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const own = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  sendVerificationCode: vi.fn(),
  verifyEmail: vi.fn(),
  sendResetCode: vi.fn(),
  resetPassword: vi.fn(),
  signOut: vi.fn(),
}));
const limits = vi.hoisted(() => ({ checkAuthLimit: vi.fn(), recordAuthFailure: vi.fn() }));
const insforge = vi.hoisted(() => ({ used: vi.fn() }));
vi.mock("@/lib/sign-in/ours", () => own);
vi.mock("@/lib/security/limits", () => limits);
vi.mock("@/lib/insforge/server", () => ({ insforgeAuthActions: async () => insforge.used() }));
vi.mock("@insforge/sdk/ssr", () => ({ createServerClient: () => insforge.used() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { completePasswordReset, requestPasswordReset, signIn, signOut, signUp, startGoogleSignIn, verifyEmailCode } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

beforeEach(() => {
  vi.stubEnv("SIGN_IN_URL", "https://api.postsocial.test/auth");
  vi.stubEnv("PUBLIC_SIGNUP", "on");
  limits.checkAuthLimit.mockResolvedValue({ blocked: null, send: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("signing in with our own sign-in", () => {
  it("opens the app, or the page the person was going to", async () => {
    own.signInWithPassword.mockResolvedValue({ signedIn: true, error: null });
    await expect(signIn({}, form({ email: "ada@example.com", password: "a-good-password-1", next: "/beta/calendar" }))).rejects.toThrow("REDIRECT /beta/calendar");
    expect(own.signInWithPassword).toHaveBeenCalledWith("ada@example.com", "a-good-password-1");
    expect(insforge.used).not.toHaveBeenCalled();
  });

  it("checks the attempt limit first and asks nobody when it is used up", async () => {
    limits.checkAuthLimit.mockResolvedValue({ blocked: "Too many attempts. Try again in 5 minutes.", send: true });
    expect(await signIn({}, form({ email: "ada@example.com", password: "a-good-password-1" }))).toEqual({ error: "Too many attempts. Try again in 5 minutes." });
    expect(own.signInWithPassword).not.toHaveBeenCalled();
  });

  it("says the same thing for a wrong password and an unknown email, and counts the miss", async () => {
    own.signInWithPassword.mockResolvedValue({ signedIn: false, error: { statusCode: 401, error: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } });
    expect(await signIn({}, form({ email: "ada@example.com", password: "wrong-password-1" }))).toEqual({ error: "That email and password do not match. Check them and try again." });
    expect(limits.recordAuthFailure).toHaveBeenCalledWith("signin", "ada@example.com");
  });

  it("doesn't count a miss when the API is down", async () => {
    own.signInWithPassword.mockResolvedValue({ signedIn: false, error: { statusCode: 503 } });
    expect(await signIn({}, form({ email: "ada@example.com", password: "a-good-password-1" }))).toEqual({ error: "The sign-in service is not responding. Try again in a moment." });
    expect(limits.recordAuthFailure).not.toHaveBeenCalled();
  });

  it("sends a fresh code and asks for it when the email isn't confirmed yet", async () => {
    own.signInWithPassword.mockResolvedValue({ signedIn: false, error: { statusCode: 403, error: "EMAIL_NOT_VERIFIED", message: "Email not verified" } });
    own.sendVerificationCode.mockResolvedValue({ error: null });
    const state = await signIn({}, form({ email: "ada@example.com", password: "a-good-password-1" }));
    expect(state).toMatchObject({ step: "verify", email: "ada@example.com" });
    expect(own.sendVerificationCode).toHaveBeenCalledWith("ada@example.com");
  });
});

describe("signing up with our own sign-in", () => {
  it("always asks for the emailed code before anyone is signed in", async () => {
    own.signUp.mockResolvedValue({ error: null });
    const state = await signUp({}, form({ name: "Ada", email: "ada@example.com", password: "a-good-password-1" }));
    expect(state).toMatchObject({ step: "verify", email: "ada@example.com" });
    expect(own.signUp).toHaveBeenCalledWith("ada@example.com", "a-good-password-1", "Ada");
  });

  it("stays closed while sign-up is invite-only, and checks the password before asking", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "");
    expect(await signUp({}, form({ name: "Ada", email: "ada@example.com", password: "a-good-password-1" }))).toEqual({ error: "Post Social is invite-only for now." });
    vi.stubEnv("PUBLIC_SIGNUP", "on");
    expect(await signUp({}, form({ name: "Ada", email: "ada@example.com", password: "short1" }))).toEqual({ error: "Use at least 12 characters." });
    expect(own.signUp).not.toHaveBeenCalled();
  });

  it("signs the person in once the code is right, and counts a wrong one", async () => {
    own.verifyEmail.mockResolvedValueOnce({ signedIn: false, error: { statusCode: 400, error: "INVALID_OTP" } });
    expect(await verifyEmailCode({}, form({ email: "ada@example.com", code: "000000" }))).toMatchObject({ step: "verify", codeRejected: true });
    expect(limits.recordAuthFailure).toHaveBeenCalledWith("reset_complete", "ada@example.com");
    own.verifyEmail.mockResolvedValueOnce({ signedIn: true, error: null });
    await expect(verifyEmailCode({}, form({ email: "ada@example.com", code: "482913" }))).rejects.toThrow("REDIRECT /beta");
  });
});

describe("resetting a password with our own sign-in", () => {
  it("answers the same whether or not the email has an account", async () => {
    own.sendResetCode.mockResolvedValue({ error: null });
    expect(await requestPasswordReset({}, form({ email: "ada@example.com" }))).toMatchObject({ step: "complete", email: "ada@example.com" });
    expect(own.sendResetCode).toHaveBeenCalledWith("ada@example.com");
  });

  it("sends nothing more once an address has had too many reset emails", async () => {
    limits.checkAuthLimit.mockResolvedValue({ blocked: null, send: false });
    expect(await requestPasswordReset({}, form({ email: "ada@example.com" }))).toMatchObject({ step: "complete" });
    expect(own.sendResetCode).not.toHaveBeenCalled();
  });

  it("sets the new password with the code, then asks the person to sign in", async () => {
    own.resetPassword.mockResolvedValue({ wrongCode: false, error: null });
    await expect(completePasswordReset({}, form({ email: "ada@example.com", code: "482913", password: "a-new-password-22" }))).rejects.toThrow("REDIRECT /beta/login?reset=done");
    expect(own.resetPassword).toHaveBeenCalledWith("ada@example.com", "482913", "a-new-password-22");
    expect(own.signOut).toHaveBeenCalled();
    expect(insforge.used).not.toHaveBeenCalled();
  });

  it("counts a wrong code, and not a service problem", async () => {
    own.resetPassword.mockResolvedValueOnce({ wrongCode: true, error: { statusCode: 400, error: "INVALID_OTP" } });
    expect(await completePasswordReset({}, form({ email: "ada@example.com", code: "000000", password: "a-new-password-22" }))).toMatchObject({ step: "complete", error: "That code is not valid or has expired. Request a new one and try again." });
    expect(limits.recordAuthFailure).toHaveBeenCalledTimes(1);
    own.resetPassword.mockResolvedValueOnce({ wrongCode: false, error: { statusCode: 503 } });
    expect(await completePasswordReset({}, form({ email: "ada@example.com", code: "482913", password: "a-new-password-22" }))).toMatchObject({ error: "The sign-in service is not responding. Try again in a moment." });
    expect(limits.recordAuthFailure).toHaveBeenCalledTimes(1);
  });
});

describe("signing out and Google with our own sign-in", () => {
  it("ends the session and goes to the sign-in page", async () => {
    await expect(signOut()).rejects.toThrow("REDIRECT /beta/login");
    expect(own.signOut).toHaveBeenCalled();
    expect(insforge.used).not.toHaveBeenCalled();
  });

  it("has no Google sign-in", async () => {
    await expect(startGoogleSignIn(form({}))).rejects.toThrow("REDIRECT /beta/login");
    expect(insforge.used).not.toHaveBeenCalled();
  });
});

describe("with the switch off", () => {
  it("asks InsForge, as before", async () => {
    vi.stubEnv("SIGN_IN_URL", "");
    insforge.used.mockReturnValue({ signInWithPassword: async () => ({ data: { user: { id: "u1" } }, error: null }) });
    await expect(signIn({}, form({ email: "ada@example.com", password: "a-good-password-1" }))).rejects.toThrow("REDIRECT /beta");
    expect(insforge.used).toHaveBeenCalled();
    expect(own.signInWithPassword).not.toHaveBeenCalled();
  });
});
