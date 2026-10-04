import { describe, expect, it } from "vitest";
import {
  isPublicBetaPath,
  passwordProblem,
  resetErrorMessage,
  safeNextPath,
  signInErrorMessage,
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

  it("explains rate limits and outages", () => {
    expect(signInErrorMessage({ statusCode: 429 })).toMatch(/Too many attempts/);
    expect(signInErrorMessage({ statusCode: 503 })).toMatch(/not responding/);
    expect(resetErrorMessage({ statusCode: 400 })).toMatch(/not valid or has expired/);
    expect(signInErrorMessage(null)).toBeNull();
  });
});
