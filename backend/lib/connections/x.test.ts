// @vitest-environment node
import { describe, expect, it } from "vitest";
import { finishXSignIn, refreshX, startXSignIn, xWeightedLength } from "./x";

const setting = (name: string) => ({ X_CLIENT_ID: "x-client", X_CLIENT_SECRET: "x-secret" })[name] ?? (() => { throw new Error(name); })();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("X sign-in", () => {
  it("asks for posting, media and offline access with a PKCE challenge", async () => {
    const { url, pending } = await startXSignIn(setting, "s1", "https://fn.example/connections/oauth/x/callback");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(u.searchParams.get("scope")).toBe("tweet.read tweet.write users.read media.write offline.access");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.verifier)));
    const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(u.searchParams.get("code_challenge")).toBe(expected);
  });

  it("exchanges the code with the verifier and reads the profile", async () => {
    const seen: Array<{ url: string; auth: string | null; body: string }> = [];
    const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({ url: String(input), auth: new Headers(init.headers).get("Authorization"), body: String(init.body ?? "") });
      if (String(input).includes("oauth2/token")) return json({ access_token: "a1", refresh_token: "r1", expires_in: 7200, scope: "tweet.read tweet.write users.read media.write offline.access" });
      return json({ data: { id: "42", name: "Aki", username: "sirakinb", profile_image_url: "https://pbs.twimg.com/profile_images/1/p_normal.jpg" } });
    }) as typeof fetch;
    const result = await finishXSignIn(setting, http, { verifier: "v1" }, "c1", "https://cb");
    expect(seen[0].auth).toBe(`Basic ${btoa("x-client:x-secret")}`);
    expect(new URLSearchParams(seen[0].body).get("code_verifier")).toBe("v1");
    expect(result).toMatchObject({ id: "42", username: "sirakinb", name: "Aki", avatar: "https://pbs.twimg.com/profile_images/1/p_400x400.jpg", tokens: { accessToken: "a1", refreshToken: "r1" } });
    expect(result.tokens.accessExpiresAt).toBeGreaterThan(Date.now());
  });

  it("refuses a sign-in without posting access", async () => {
    const http = (async () => json({ access_token: "a", scope: "tweet.read users.read" })) as unknown as typeof fetch;
    await expect(finishXSignIn(setting, http, { verifier: "v" }, "c", "r")).rejects.toThrow("did not grant posting access");
  });

  it("keeps the new refresh token X hands back", async () => {
    const http = (async () => json({ access_token: "a2", refresh_token: "r2", expires_in: 7200 })) as unknown as typeof fetch;
    expect(await refreshX(setting, http, { accessToken: "a1", refreshToken: "r1" })).toMatchObject({ accessToken: "a2", refreshToken: "r2" });
    await expect(refreshX(setting, http, { accessToken: "a1" })).rejects.toThrow("nothing to renew");
  });

  it("weighs text the way X does", () => {
    expect(xWeightedLength("hello")).toBe(5);
    expect(xWeightedLength("see https://example.com/a/very/long/path/that/goes/on")).toBe(4 + 23);
    expect(xWeightedLength("👍🏽")).toBe(2);
    expect(xWeightedLength("日本")).toBe(4);
  });
});
