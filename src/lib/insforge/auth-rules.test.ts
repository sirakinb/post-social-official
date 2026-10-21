import { describe, expect, it } from "vitest";
import {
  isPublicBetaPath,
  passwordProblem,
  resetErrorMessage,
  safeNextPath,
  signInErrorMessage,
  signUpErrorMessage,
  signupOpen,
  needsEmailVerification,
  verifyErrorMessage,
} from "./auth-rules";

describe("safeNextPath", () => {
  it("keeps paths inside the new app, with their query", () => {
    expect(safeNextPath("/beta")).toBe("/beta");
    expect(safeNextPath("/beta/posts?status=draft")).toBe("/beta/posts?status=draft");
  });

  it("falls back to the new app home for anything else", () => {
    for (const next of [
      null,
      undefined,
      "",
      "https://evil.example/beta",
      "//evil.example/beta",
      "/\\evil.example",
      "/app",
      "/betamax",
      "/beta/../app",
      "javascript:alert(1)",
      "/beta/login",
      "/beta/reset-password",
    ]) {
      expect(safeNextPath(next), String(next)).toBe("/beta");
    }
  });
});

describe("isPublicBetaPath", () => {
  it("allows only the sign-in and reset pages", () => {
    expect(isPublicBetaPath("/beta/login")).toBe(true);
    expect(isPublicBetaPath("/beta/login/")).toBe(true);
    expect(isPublicBetaPath("/beta/reset-password")).toBe(true);
    expect(isPublicBetaPath("/beta")).toBe(false);
    expect(isPublicBetaPath("/beta/login-help")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("matches the policy in insforge.toml", () => {
    expect(passwordProblem("short1")).toMatch(/at least 12/);
    expect(passwordProblem("no-numbers-here")).toMatch(/number/);
    expect(passwordProblem("long-enough-1")).toBeNull();
  });
});

describe("error messages", () => {
  it("never reveals whether an email has an account", () => {
    const unknownEmail = signInErrorMessage({ statusCode: 404, error: "USER_NOT_FOUND" });
    const wrongPassword = signInErrorMessage({ statusCode: 401, error: "AUTH_INVALID_CREDENTIALS" });
    expect(unknownEmail).toBe(wrongPassword);
  });

  it("says so when the password is right but the email is unconfirmed, instead of 'do not match'", () => {
    // What InsForge returns when require_email_verification is on (seen on prod 2026-10-21).
    const unverified = { statusCode: 403, error: "FORBIDDEN", message: "Email verification required" };
    expect(needsEmailVerification(unverified)).toBe(true);
    expect(signInErrorMessage(unverified)).toMatch(/Confirm your email/);
    expect(signInErrorMessage(unverified)).not.toMatch(/do not match/);
    expect(needsEmailVerification({ statusCode: 401, error: "AUTH_INVALID_CREDENTIALS" })).toBe(false);
    expect(needsEmailVerification({ statusCode: 403, message: "Forbidden" })).toBe(false);
    expect(verifyErrorMessage({ statusCode: 400 })).toMatch(/not valid or has expired/);
  });

  it("explains rate limits and outages", () => {
    expect(signInErrorMessage({ statusCode: 429 })).toMatch(/Too many attempts/);
    expect(signInErrorMessage({ statusCode: 503 })).toMatch(/not responding/);
    expect(resetErrorMessage({ statusCode: 400 })).toMatch(/not valid or has expired/);
    expect(signInErrorMessage(null)).toBeNull();
  });
});

describe("open sign-up", () => {
  it("is off unless switched on", () => {
    expect(signupOpen({})).toBe(false);
    expect(signupOpen({ PUBLIC_SIGNUP: "true" })).toBe(false);
    expect(signupOpen({ PUBLIC_SIGNUP: "on" })).toBe(true);
  });
  it("lets signed-out visitors reach the sign-up page and Google's return address", () => {
    expect(isPublicBetaPath("/beta/signup")).toBe(true);
    expect(isPublicBetaPath("/beta/auth/callback")).toBe(true);
  });
  it("never says whether an email already has an account", () => {
    expect(signUpErrorMessage({ statusCode: 409 })).toBe(signUpErrorMessage({ statusCode: 400 }));
    expect(signUpErrorMessage({ statusCode: 429 })).toMatch(/Too many attempts/);
  });
});
