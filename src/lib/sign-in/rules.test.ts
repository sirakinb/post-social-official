import { describe, expect, it } from "vitest";
import { functionsBaseUrl, ownSignInUrl, pageReadsViaApi, SESSION_COOKIE, SESSION_SECONDS, sessionCookieOptions } from "./rules";

describe("which sign-in the website uses", () => {
  it("is InsForge's unless SIGN_IN_URL names our own API", () => {
    expect(ownSignInUrl({})).toBeNull();
    expect(ownSignInUrl({ SIGN_IN_URL: "" })).toBeNull();
    expect(ownSignInUrl({ SIGN_IN_URL: "on" })).toBeNull();
    expect(ownSignInUrl({ SIGN_IN_URL: "https://api-dev.postsocial.xyz/auth" })).toBe("https://api-dev.postsocial.xyz/auth");
    expect(ownSignInUrl({ SIGN_IN_URL: " https://api.postsocial.xyz/auth/ " })).toBe("https://api.postsocial.xyz/auth");
  });

  it("finds the posts and media functions on InsForge, or on our own API when told", () => {
    expect(functionsBaseUrl({ NEXT_PUBLIC_INSFORGE_URL: "https://abc.insforge.app" })).toBe("https://abc.insforge.app/functions");
    expect(functionsBaseUrl({ NEXT_PUBLIC_INSFORGE_URL: "https://abc.insforge.app", FUNCTIONS_BASE_URL: "https://api-dev.postsocial.xyz/functions/" })).toBe("https://api-dev.postsocial.xyz/functions");
  });

  it("has the pages read through our API when told to, and always once sign-in is our own", () => {
    expect(pageReadsViaApi({})).toBe(false);
    expect(pageReadsViaApi({ PAGE_READS: "on" })).toBe(false);
    expect(pageReadsViaApi({ PAGE_READS: "api" })).toBe(true);
    // InsForge's database doesn't know our own sessions, so there is no other way then.
    expect(pageReadsViaApi({ SIGN_IN_URL: "https://api-dev.postsocial.xyz/auth" })).toBe(true);
  });

  it("keeps the session in a cookie page scripts can't read, for as long as the API keeps the session", () => {
    expect(SESSION_COOKIE).toBe("ps_session");
    expect(sessionCookieOptions({ NODE_ENV: "production" })).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    expect(sessionCookieOptions({ NODE_ENV: "development" }).secure).toBe(false);
    expect(SESSION_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});
