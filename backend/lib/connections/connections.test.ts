// @vitest-environment node
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openCredential, sealCredential } from "../../../convex/lib/credentialCrypto";
import { importKey, open, seal, sha256Hex } from "./crypto";
import { SCOPES, authorizeUrl, exchangeCode, refreshTokens, revokeTokens, type Platform } from "./platforms";
import { callbackUrl, originAllowedFor } from "./service";

const settings: Record<string, string> = {
  TIKTOK_CLIENT_KEY: "tk",
  TIKTOK_CLIENT_SECRET: "ts",
  INSTAGRAM_APP_ID: "ig-app",
  INSTAGRAM_APP_SECRET: "ig-secret",
  META_APP_ID: "fb-app",
  META_APP_SECRET: "fb-secret",
  META_LOGIN_CONFIG_ID: "cfg",
  THREADS_APP_ID: "th-app",
  THREADS_APP_SECRET: "th-secret",
  GOOGLE_CLIENT_ID: "g-client",
  GOOGLE_CLIENT_SECRET: "g-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3333/oauth/youtube/callback",
  CONNECTIONS_BASE_URL: "https://fn.example/connections",
};
const setting = (name: string) => {
  if (!(name in settings)) throw new Error(`missing ${name}`);
  return settings[name];
};

// A fake platform: answers by URL, records requests.
function fakeHttp(routes: Array<[RegExp, unknown, number?]>) {
  const calls: string[] = [];
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response(JSON.stringify({ error: { message: "unexpected" } }), { status: 500 });
    return new Response(JSON.stringify(route[1]), { status: route[2] ?? 200 });
  }) as typeof fetch;
  return { http, calls };
}

describe("token encryption", () => {
  it("round-trips and is compatible with the Convex format in both directions", async () => {
    const raw = randomBytes(32);
    const key = await importKey(raw.toString("base64"));
    const tokens = { accessToken: "access-1", refreshToken: "refresh-1" };

    const sealed = await seal(tokens, key);
    expect(await open(sealed, key)).toEqual(tokens);
    expect(openCredential(sealed, raw)).toEqual(tokens);
    expect(await open(sealCredential(tokens, raw), key)).toEqual(tokens);
  });

  it("refuses tampered data and bad keys", async () => {
    const key = await importKey(randomBytes(32).toString("base64"));
    const sealed = await seal({ accessToken: "a" }, key);
    const tampered = { ...sealed, encryptedPayload: Buffer.from("x".repeat(40)).toString("base64") };
    await expect(open(tampered, key)).rejects.toThrow();
    await expect(importKey(randomBytes(16).toString("base64"))).rejects.toThrow(/32-byte/);
    await expect(importKey(undefined)).rejects.toThrow(/not configured/);
  });

  it("hashes sign-in state with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("sign-in links", () => {
  it.each(["instagram", "facebook", "threads", "youtube", "tiktok"] as Platform[])("asks %s for exactly the permissions in the PRD", (platform) => {
    const url = new URL(authorizeUrl(platform, "state-1", callbackUrl(platform, setting), setting));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope.split(/[ ,]/).sort()).toEqual([...SCOPES[platform]].sort());
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("sends YouTube back to the web app and everyone else to the function", () => {
    expect(callbackUrl("youtube", setting)).toBe("http://localhost:3333/oauth/youtube/callback");
    expect(callbackUrl("instagram", setting)).toBe("https://fn.example/connections/oauth/instagram/callback");
    const google = new URL(authorizeUrl("youtube", "s", callbackUrl("youtube", setting), setting));
    expect(google.searchParams.get("access_type")).toBe("offline");
    expect(google.searchParams.get("prompt")).toBe("consent");
  });

  it("sends TikTok to an already-approved address when one is set", () => {
    expect(callbackUrl("tiktok", setting)).toBe("https://fn.example/connections/oauth/tiktok/callback");
    const withOverride = (name: string) => (name === "TIKTOK_REDIRECT_URI" ? "https://old.example/api/oauth/tiktok/callback" : setting(name));
    expect(callbackUrl("tiktok", withOverride)).toBe("https://old.example/api/oauth/tiktok/callback");
    expect(callbackUrl("instagram", withOverride)).toBe("https://fn.example/connections/oauth/instagram/callback");
  });
});

describe("return addresses", () => {
  const allowed = ["http://localhost:3333", "https://post-social-*-app-build-26.vercel.app", "https://www.postsocial.xyz"];
  it("only returns people to the web app", () => {
    expect(originAllowedFor("http://localhost:3333/beta/accounts?x=1", allowed)).toBe(true);
    expect(originAllowedFor("https://post-social-git-a-app-build-26.vercel.app/beta/accounts", allowed)).toBe(true);
    expect(originAllowedFor("https://www.postsocial.xyz/beta/accounts", allowed)).toBe(true);
    expect(originAllowedFor("https://evil.example/beta/accounts", allowed)).toBe(false);
    expect(originAllowedFor("https://www.postsocial.xyz.evil.example/", allowed)).toBe(false);
    expect(originAllowedFor("javascript:alert(1)", allowed)).toBe(false);
    expect(originAllowedFor("not a url", allowed)).toBe(false);
  });
});

describe("exchanging sign-in codes", () => {
  it("Instagram: short token, long token, then the professional profile", async () => {
    const { http, calls } = fakeHttp([
      [/api\.instagram\.com\/oauth\/access_token/, { access_token: "short", user_id: 17 }],
      [/graph\.instagram\.com\/access_token/, { access_token: "long", expires_in: 5184000 }],
      [/graph\.instagram\.com\/v25\.0\/me/, { id: "1789", username: "akib", name: "Aki", profile_picture_url: "https://cdn/p.jpg" }],
    ]);
    const [identity] = await exchangeCode("instagram", "code-1", callbackUrl("instagram", setting), setting, http);
    expect(identity).toMatchObject({ externalAccountId: "1789", ownerExternalId: "1789", handle: "akib", displayName: "Aki", tokens: { accessToken: "long" } });
    expect(identity.capabilities.image_types).toEqual(["image/jpeg"]);
    expect(identity.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 24 * 3600 * 1000);
    expect(calls).toHaveLength(3);
  });

  it("Facebook: one account per Page that came with a token", async () => {
    const { http } = fakeHttp([
      [/oauth\/access_token\?client_id=fb-app&client_secret=fb-secret&redirect_uri/, { access_token: "short" }],
      [/grant_type=fb_exchange_token/, { access_token: "user-long" }],
      [/\/me\?fields=id&/, { id: "meta-user-9" }],
      [/me\/accounts/, { data: [
        { id: "p1", name: "Pentridge", access_token: "page-1", tasks: ["CREATE_CONTENT"], picture: { data: { url: "https://cdn/p1.png" } } },
        { id: "p2", name: "No token" },
      ] }],
    ]);
    const identities = await exchangeCode("facebook", "c", callbackUrl("facebook", setting), setting, http);
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ externalAccountId: "p1", ownerExternalId: "meta-user-9", displayName: "Pentridge", tokens: { accessToken: "page-1" } });
    expect(identities[0].accessTokenExpiresAt).toBeUndefined();
  });

  it("Facebook: explains when no Page was shared", async () => {
    const { http } = fakeHttp([
      [/redirect_uri/, { access_token: "short" }],
      [/fb_exchange_token/, { access_token: "user-long" }],
      [/\/me\?fields=id/, { id: "u" }],
      [/me\/accounts/, { data: [] }],
    ]);
    await expect(exchangeCode("facebook", "c", "r", setting, http)).rejects.toThrow(/did not share|shared no Facebook Pages/);
  });

  it("TikTok: keeps the creator's own maximum video length", async () => {
    const { http } = fakeHttp([
      [/oauth\/token/, { access_token: "a", refresh_token: "r", open_id: "oid", expires_in: 86400, refresh_expires_in: 31536000, scope: "user.info.basic,video.publish,video.upload" }],
      [/creator_info/, { data: { creator_username: "aki", creator_nickname: "Aki", max_video_post_duration_sec: 300 }, error: { code: "ok" } }],
    ]);
    const [identity] = await exchangeCode("tiktok", "c", "r", setting, http);
    expect(identity).toMatchObject({ externalAccountId: "oid", handle: "aki", tokens: { accessToken: "a", refreshToken: "r" } });
    expect(identity.capabilities.video_max_seconds).toBe(300);
  });

  it("YouTube: requires lasting access", async () => {
    const withRefresh = fakeHttp([[/oauth2\.googleapis\.com\/token/, { access_token: "a", refresh_token: "r", expires_in: 3599 }]]);
    const [identity] = await exchangeCode("youtube", "c", "r", setting, withRefresh.http);
    expect(identity.tokens).toEqual({ accessToken: "a", refreshToken: "r" });
    const without = fakeHttp([[/oauth2\.googleapis\.com\/token/, { access_token: "a", expires_in: 3599 }]]);
    await expect(exchangeCode("youtube", "c", "r", setting, without.http)).rejects.toThrow(/myaccount\.google\.com/);
  });

  it("turns platform errors into plain messages", async () => {
    const { http } = fakeHttp([[/oauth\/access_token/, { error: { message: "Invalid verification code format.", code: 100 } }, 400]]);
    await expect(exchangeCode("threads", "c", "r", setting, http)).rejects.toThrow("Threads sign-in failed: Invalid verification code format.");
  });
});

describe("refresh and revoke", () => {
  it("refreshes each platform the way it expects", async () => {
    const ig = fakeHttp([[/refresh_access_token\?grant_type=ig_refresh_token/, { access_token: "new", expires_in: 5184000 }]]);
    expect((await refreshTokens("instagram", { accessToken: "old" }, setting, ig.http))!.tokens.accessToken).toBe("new");
    const tt = fakeHttp([[/oauth\/token/, { access_token: "new", expires_in: 86400 }]]);
    expect((await refreshTokens("tiktok", { accessToken: "old", refreshToken: "r" }, setting, tt.http))!.tokens).toEqual({ accessToken: "new", refreshToken: "r" });
    expect(await refreshTokens("facebook", { accessToken: "page" }, setting)).toBeNull();
    await expect(refreshTokens("youtube", { accessToken: "a" }, setting)).rejects.toThrow(/refresh token is missing/);
  });

  it("revokes and reports the outcome without throwing", async () => {
    const google = fakeHttp([[/oauth2\.googleapis\.com\/revoke\?token=refresh-1/, {}]]);
    expect(await revokeTokens("youtube", { accessToken: "a", refreshToken: "refresh-1" }, setting, google.http)).toBe("confirmed");
    const meta = fakeHttp([[/graph\.facebook\.com\/v25\.0\/me\/permissions/, {}, 400]]);
    expect(await revokeTokens("facebook", { accessToken: "a" }, setting, meta.http)).toBe("platform_http_400");
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await revokeTokens("tiktok", { accessToken: "a" }, setting, down)).toBe("platform_unreachable");
  });
});
