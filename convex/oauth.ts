"use node";

import { createHash, randomBytes } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { assertConnectionWorkspace, canPublishToFacebookPage, platformResponseError } from "./lib/platformRules";
import { buildAuthUrl as buildYouTubeAuthUrl, exchangeCodeForTokens as exchangeYouTubeCode } from "./lib/youtubeService";

const API_VERSION = "v25.0";
const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];
const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];
const THREADS_SCOPES = ["threads_basic", "threads_content_publish"];
const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

type OAuthProvider = "tiktok" | "instagram" | "facebook" | "threads" | "youtube";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is not configured.`); return value; }
function stateHash(state: string) { return createHash("sha256").update(state).digest("hex"); }
function callbackUrl(provider: OAuthProvider) { return `${required("OAUTH_CALLBACK_BASE_URL")}/api/oauth/${provider}/callback`; }
function instagramAppId() { return process.env.INSTAGRAM_APP_ID || required("META_APP_ID"); }
function instagramAppSecret() { return process.env.INSTAGRAM_APP_SECRET || required("META_APP_SECRET"); }

async function createState(ctx: any, workspaceId: any, provider: OAuthProvider) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in is required.");
  await ctx.runQuery(api.workspaces.get, { workspaceId });
  const state = randomBytes(32).toString("base64url");
  await ctx.runMutation(internal.oauthState.create, { workspaceId, identitySubject: identity.tokenIdentifier, provider, stateHash: stateHash(state), expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}

export const startTikTok = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<string> => {
    const state = await createState(ctx, workspaceId, "tiktok");
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", required("TIKTOK_CLIENT_KEY")); url.searchParams.set("response_type", "code"); url.searchParams.set("scope", TIKTOK_SCOPES.join(",")); url.searchParams.set("redirect_uri", callbackUrl("tiktok")); url.searchParams.set("state", state);
    return url.toString();
  },
});

export const startInstagram = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<string> => {
    const state = await createState(ctx, workspaceId, "instagram");
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", instagramAppId());
    url.searchParams.set("redirect_uri", callbackUrl("instagram"));
    url.searchParams.set("state", state);
    url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    return url.toString();
  },
});

export const startFacebook = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<string> => {
    const state = await createState(ctx, workspaceId, "facebook");
    const url = new URL(`https://www.facebook.com/${API_VERSION}/dialog/oauth`);
    url.searchParams.set("client_id", required("META_APP_ID"));
    url.searchParams.set("redirect_uri", callbackUrl("facebook"));
    url.searchParams.set("state", state);
    url.searchParams.set("scope", FACEBOOK_SCOPES.join(","));
    url.searchParams.set("config_id", required("META_LOGIN_CONFIG_ID"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("override_default_response_type", "true");
    return url.toString();
  },
});

export const startThreads = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<string> => {
    const state = await createState(ctx, workspaceId, "threads");
    const url = new URL("https://threads.net/oauth/authorize");
    url.searchParams.set("client_id", required("THREADS_APP_ID"));
    url.searchParams.set("redirect_uri", callbackUrl("threads"));
    url.searchParams.set("state", state);
    url.searchParams.set("scope", THREADS_SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    return url.toString();
  },
});

export const startYouTube = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<string> => {
    const state = await createState(ctx, workspaceId, "youtube");
    // Google's redirect URI is registered on the app domain (GOOGLE_REDIRECT_URI),
    // not on the Convex callback base the other platforms use.
    return buildYouTubeAuthUrl(state);
  },
});

async function jsonOrThrow(response: Response) {
  const payload = await response.json();
  const code = platformResponseError(response.ok, response.status, payload.error);
  if (code) throw new Error(payload.error?.message ?? `Platform request failed (${response.status}).`);
  return payload;
}

export const completeTikTok = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ workspaceId: string }> => {
    const session = await ctx.runMutation(internal.oauthState.consume, { stateHash: stateHash(args.state), provider: "tiktok" });
    if (!session) throw new Error("The TikTok connection request expired. Please start again.");
    const body = new URLSearchParams({ client_key: required("TIKTOK_CLIENT_KEY"), client_secret: required("TIKTOK_CLIENT_SECRET"), code: args.code, grant_type: "authorization_code", redirect_uri: callbackUrl("tiktok") });
    const token = await jsonOrThrow(await fetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }));
    const creator = await jsonOrThrow(await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json; charset=UTF-8" } }));
    const externalId = String(token.open_id); const existing = await ctx.runQuery(internal.oauthState.existingAccount, { platform: "tiktok", externalAccountId: externalId });
    assertConnectionWorkspace(existing?.workspaceId, session.workspaceId);
    const credentialId = await ctx.runAction(internal.credentialVault.encryptAndStore, { credentialId: existing?.credentialId, workspaceId: session.workspaceId, platform: "tiktok", accessToken: token.access_token, refreshToken: token.refresh_token, accessTokenExpiresAt: Date.now() + Number(token.expires_in) * 1000, refreshTokenExpiresAt: token.refresh_expires_in ? Date.now() + Number(token.refresh_expires_in) * 1000 : undefined });
    await ctx.runMutation(internal.oauthState.upsertAccount, { workspaceId: session.workspaceId, platform: "tiktok", externalAccountId: externalId, handle: creator.data.creator_username ?? creator.data.creator_nickname, displayName: creator.data.creator_nickname, avatarUrl: creator.data.creator_avatar_url, scopes: String(token.scope ?? TIKTOK_SCOPES.join(",")).split(","), credentialId });
    return { workspaceId: session.workspaceId };
  },
});

export const completeInstagram = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ workspaceId: string }> => {
    const session = await ctx.runMutation(internal.oauthState.consume, { stateHash: stateHash(args.state), provider: "instagram" });
    if (!session) throw new Error("The Instagram connection request expired. Please start again.");
    const shortTokenBody = new URLSearchParams({
      client_id: instagramAppId(),
      client_secret: instagramAppSecret(),
      grant_type: "authorization_code",
      redirect_uri: callbackUrl("instagram"),
      code: args.code,
    });
    const shortToken = await jsonOrThrow(await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: shortTokenBody,
    }));
    const longTokenUrl = new URL("https://graph.instagram.com/access_token");
    longTokenUrl.searchParams.set("grant_type", "ig_exchange_token");
    longTokenUrl.searchParams.set("client_secret", instagramAppSecret());
    longTokenUrl.searchParams.set("access_token", shortToken.access_token);
    const longToken = await jsonOrThrow(await fetch(longTokenUrl));
    const accessToken = longToken.access_token ?? shortToken.access_token;
    const profileUrl = new URL(`https://graph.instagram.com/${API_VERSION}/me`);
    profileUrl.searchParams.set("fields", "id,user_id,username,name,profile_picture_url");
    profileUrl.searchParams.set("access_token", accessToken);
    const profile = await jsonOrThrow(await fetch(profileUrl));
    const externalId = String(profile.id ?? profile.user_id ?? shortToken.user_id);
    if (!externalId || externalId === "undefined") throw new Error("Instagram did not return a professional account identifier.");
    const existing = await ctx.runQuery(internal.oauthState.existingAccount, { platform: "instagram", externalAccountId: externalId });
    assertConnectionWorkspace(existing?.workspaceId, session.workspaceId);
    const credentialId = await ctx.runAction(internal.credentialVault.encryptAndStore, {
      credentialId: existing?.credentialId,
      workspaceId: session.workspaceId,
      platform: "instagram",
      accessToken,
      accessTokenExpiresAt: longToken.expires_in ? Date.now() + Number(longToken.expires_in) * 1000 : undefined,
    });
    await ctx.runMutation(internal.oauthState.upsertAccount, {
      workspaceId: session.workspaceId,
      platform: "instagram",
      externalAccountId: externalId,
      handle: profile.username ?? profile.name ?? "instagram",
      displayName: profile.name ?? profile.username ?? "Instagram account",
      avatarUrl: profile.profile_picture_url,
      scopes: INSTAGRAM_SCOPES,
      credentialId,
      ownerExternalId: externalId,
    });
    return { workspaceId: session.workspaceId };
  },
});

export const completeFacebook = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ workspaceId: string; connected: number }> => {
    const session = await ctx.runMutation(internal.oauthState.consume, { stateHash: stateHash(args.state), provider: "facebook" });
    if (!session) throw new Error("The Facebook connection request expired. Please start again.");
    const tokenUrl = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", required("META_APP_ID"));
    tokenUrl.searchParams.set("client_secret", required("META_APP_SECRET"));
    tokenUrl.searchParams.set("redirect_uri", callbackUrl("facebook"));
    tokenUrl.searchParams.set("code", args.code);
    const shortToken = await jsonOrThrow(await fetch(tokenUrl));
    const longTokenUrl = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
    longTokenUrl.searchParams.set("grant_type", "fb_exchange_token");
    longTokenUrl.searchParams.set("client_id", required("META_APP_ID"));
    longTokenUrl.searchParams.set("client_secret", required("META_APP_SECRET"));
    longTokenUrl.searchParams.set("fb_exchange_token", shortToken.access_token);
    const userToken = await jsonOrThrow(await fetch(longTokenUrl));
    const userUrl = new URL(`https://graph.facebook.com/${API_VERSION}/me`);
    userUrl.searchParams.set("fields", "id");
    userUrl.searchParams.set("access_token", userToken.access_token);
    const facebookUser = await jsonOrThrow(await fetch(userUrl));
    const pagesUrl = new URL(`https://graph.facebook.com/${API_VERSION}/me/accounts`);
    pagesUrl.searchParams.set("fields", "id,name,access_token,tasks,picture");
    pagesUrl.searchParams.set("access_token", userToken.access_token);
    const pages = await jsonOrThrow(await fetch(pagesUrl));
    const pageCandidates = Array.isArray(pages.data) ? pages.data : [];
    console.info("Facebook Page discovery", pageCandidates.map((page: any) => ({
      name: page.name,
      hasAccessToken: Boolean(page.access_token),
      tasks: Array.isArray(page.tasks) ? page.tasks : [],
    })));
    const manageablePages = [] as any[];
    for (const page of pageCandidates) {
      if (typeof page.access_token !== "string" || !page.access_token) continue;
      if (!canPublishToFacebookPage(page.tasks)) {
        console.info("Facebook Page token returned without a recognized publishing task", {
          name: page.name,
          tasks: Array.isArray(page.tasks) ? page.tasks : [],
        });
      }
      manageablePages.push(page);
    }
    const existingPages = await Promise.all(manageablePages.map(async (page) => ({
      page,
      existing: await ctx.runQuery(internal.oauthState.existingAccount, { platform: "facebook", externalAccountId: String(page.id) }),
    })));
    for (const { existing } of existingPages) assertConnectionWorkspace(existing?.workspaceId, session.workspaceId);
    let connected = 0;
    for (const { page, existing: fbExisting } of existingPages) {
      const fbCredential = await ctx.runAction(internal.credentialVault.encryptAndStore, { credentialId: fbExisting?.credentialId, workspaceId: session.workspaceId, platform: "facebook", accessToken: page.access_token });
      await ctx.runMutation(internal.oauthState.upsertAccount, { workspaceId: session.workspaceId, platform: "facebook", externalAccountId: String(page.id), ownerExternalId: String(facebookUser.id), handle: page.name, displayName: page.name, avatarUrl: page.picture?.data?.url, scopes: FACEBOOK_SCOPES, credentialId: fbCredential });
      connected++;
    }
    if (!connected) {
      if (!pageCandidates.length) {
        throw new Error("Meta connected successfully but did not return any Facebook Pages. Reconnect and share at least one Page in Edit settings.");
      }
      throw new Error(`Meta returned ${pageCandidates.length} Facebook Page(s), but none included content publishing access.`);
    }
    return { workspaceId: session.workspaceId, connected };
  },
});

export const completeYouTube = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ workspaceId: string }> => {
    const session = await ctx.runMutation(internal.oauthState.consume, { stateHash: stateHash(args.state), provider: "youtube" });
    if (!session) throw new Error("The YouTube connection request expired. Please start again.");
    const tokens = await exchangeYouTubeCode(args.code);
    // The youtube.upload scope cannot read channel details, so the connection is
    // keyed to the workspace and shown as "YouTube channel" in the UI.
    const externalId = `workspace:${session.workspaceId}`;
    const existing = await ctx.runQuery(internal.oauthState.existingAccount, { platform: "youtube", externalAccountId: externalId });
    assertConnectionWorkspace(existing?.workspaceId, session.workspaceId);
    const credentialId = await ctx.runAction(internal.credentialVault.encryptAndStore, {
      credentialId: existing?.credentialId,
      workspaceId: session.workspaceId,
      platform: "youtube",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: Date.now() + Number(tokens.expires_in) * 1000 - 5 * 60 * 1000,
    });
    await ctx.runMutation(internal.oauthState.upsertAccount, {
      workspaceId: session.workspaceId,
      platform: "youtube",
      externalAccountId: externalId,
      handle: "youtube",
      displayName: "YouTube channel",
      scopes: String(tokens.scope ?? YOUTUBE_SCOPES.join(" ")).split(" "),
      credentialId,
    });
    return { workspaceId: session.workspaceId };
  },
});

export const completeThreads = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ workspaceId: string }> => {
    const session = await ctx.runMutation(internal.oauthState.consume, {
      stateHash: stateHash(args.state),
      provider: "threads",
    });
    if (!session) throw new Error("The Threads connection request expired. Please start again.");

    const shortToken = await jsonOrThrow(await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: required("THREADS_APP_ID"),
        client_secret: required("THREADS_APP_SECRET"),
        grant_type: "authorization_code",
        redirect_uri: callbackUrl("threads"),
        code: args.code,
      }),
    }));

    const longTokenUrl = new URL("https://graph.threads.net/access_token");
    longTokenUrl.searchParams.set("grant_type", "th_exchange_token");
    longTokenUrl.searchParams.set("client_secret", required("THREADS_APP_SECRET"));
    longTokenUrl.searchParams.set("access_token", shortToken.access_token);
    const longToken = await jsonOrThrow(await fetch(longTokenUrl));
    const accessToken = longToken.access_token ?? shortToken.access_token;

    const profileUrl = new URL("https://graph.threads.net/v1.0/me");
    profileUrl.searchParams.set("fields", "id,username,threads_profile_picture_url");
    profileUrl.searchParams.set("access_token", accessToken);
    const profile = await jsonOrThrow(await fetch(profileUrl));
    const externalId = String(profile.id ?? shortToken.user_id);
    if (!externalId || externalId === "undefined") throw new Error("Threads did not return an account identifier.");

    const existing = await ctx.runQuery(internal.oauthState.existingAccount, {
      platform: "threads",
      externalAccountId: externalId,
    });
    assertConnectionWorkspace(existing?.workspaceId, session.workspaceId);
    const credentialId = await ctx.runAction(internal.credentialVault.encryptAndStore, {
      credentialId: existing?.credentialId,
      workspaceId: session.workspaceId,
      platform: "threads",
      accessToken,
      accessTokenExpiresAt: longToken.expires_in
        ? Date.now() + Number(longToken.expires_in) * 1000
        : undefined,
    });
    const username = String(profile.username ?? "threads");
    await ctx.runMutation(internal.oauthState.upsertAccount, {
      workspaceId: session.workspaceId,
      platform: "threads",
      externalAccountId: externalId,
      handle: username,
      displayName: username,
      avatarUrl: profile.threads_profile_picture_url,
      scopes: THREADS_SCOPES,
      credentialId,
      ownerExternalId: externalId,
    });
    return { workspaceId: session.workspaceId };
  },
});
