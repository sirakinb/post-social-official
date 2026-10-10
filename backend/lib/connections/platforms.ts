// Per-platform sign-in, token exchange, refresh and revoke. Ported from convex/oauth.ts,
// convex/tokenLifecycle.ts and convex/lib/platformRevocation.ts; runtime-neutral (fetch
// only). Scopes are exactly those in the PRD, section 6. Bluesky's sign-in is different
// (pushed requests and DPoP-bound tokens) and lives in atproto.ts.
import { BLUESKY_SCOPE, publicProfile, refreshSession, revokeSession, type BlueskySession } from "./atproto";
import type { TokenSet } from "./crypto";
import { X_SCOPES, refreshX, revokeX } from "./x";

export type Platform = "instagram" | "facebook" | "threads" | "youtube" | "tiktok" | "linkedin" | "bluesky" | "x";
export const PLATFORMS: Platform[] = ["instagram", "facebook", "threads", "youtube", "tiktok", "linkedin", "bluesky", "x"];

export type Settings = (name: string) => string;

export type Identity = {
  externalAccountId: string;
  ownerExternalId?: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  scopes: string[];
  tokens: TokenSet;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  capabilities: Capabilities;
};

export type Capabilities = {
  post_types: string[];
  caption_max_chars: number;
  video_max_seconds?: number;
  video_min_seconds?: number;
  carousel_max_items?: number;
  image_types?: string[];
  notes?: string;
};

export class PlatformError extends Error {
  constructor(message: string, public code = "platform_error") {
    super(message);
  }
}

const META_VERSION = "v25.0";

export const SCOPES: Record<Platform, string[]> = {
  tiktok: ["user.info.basic", "video.publish", "video.upload"],
  instagram: ["instagram_business_basic", "instagram_business_content_publish"],
  facebook: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
  threads: ["threads_basic", "threads_content_publish"],
  youtube: ["https://www.googleapis.com/auth/youtube.upload"],
  // Sign In with LinkedIn (name and photo) + Share on LinkedIn (posting as the member).
  linkedin: ["openid", "profile", "w_member_social"],
  bluesky: BLUESKY_SCOPE.split(" "),
  x: X_SCOPES,
};

// Read permissions for post stats (Phase 5D). They are requested only where analytics is
// switched on (ANALYTICS_PLATFORMS), because platforms refuse or skip permissions their
// review has not approved yet. Facebook's come from its Meta login configuration instead.
export const ANALYTICS_SCOPES: Record<Platform, string[]> = {
  tiktok: ["video.list"],
  instagram: ["instagram_business_manage_insights"],
  facebook: [],
  threads: ["threads_manage_insights"],
  youtube: ["https://www.googleapis.com/auth/youtube.readonly"],
  linkedin: [],
  bluesky: [],
  x: [],
};

export function analyticsPlatforms(setting: Settings): Platform[] {
  let raw = "";
  try {
    raw = setting("ANALYTICS_PLATFORMS");
  } catch {
    return [];
  }
  return raw.split(",").map((p) => p.trim()).filter((p): p is Platform => PLATFORMS.includes(p as Platform));
}

export function scopesFor(platform: Platform, setting: Settings) {
  return analyticsPlatforms(setting).includes(platform) ? [...SCOPES[platform], ...ANALYTICS_SCOPES[platform]] : SCOPES[platform];
}

export const DISPLAY_NAMES: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook Pages",
  threads: "Threads",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
  x: "X",
};

// What each platform accepts through its API (2026 documentation). Stored on each account
// so AI clients can plan posts without guessing.
export const CAPABILITIES: Record<Platform, Capabilities> = {
  instagram: {
    post_types: ["image", "reel", "carousel"],
    caption_max_chars: 2200,
    video_min_seconds: 3,
    video_max_seconds: 900,
    carousel_max_items: 10,
    image_types: ["image/jpeg"],
    notes: "Images must be JPEG.",
  },
  facebook: {
    post_types: ["text", "link", "image", "reel", "video"],
    caption_max_chars: 63206,
    video_min_seconds: 3,
    video_max_seconds: 90,
    notes: "Reels are 3-90 seconds; longer videos post as Page videos.",
  },
  threads: { post_types: ["text", "image", "video", "carousel"], caption_max_chars: 500, video_max_seconds: 300, carousel_max_items: 20 },
  youtube: { post_types: ["short"], caption_max_chars: 5000, video_max_seconds: 180, notes: "Titles are at most 100 characters." },
  tiktok: {
    post_types: ["video", "photo", "inbox_draft"],
    caption_max_chars: 2200,
    video_max_seconds: 600,
    notes: "Each creator's own maximum video length is checked before posting.",
  },
  linkedin: {
    post_types: ["text", "image", "video"],
    caption_max_chars: 3000,
    video_min_seconds: 3,
    video_max_seconds: 1800,
    carousel_max_items: 20,
    image_types: ["image/jpeg", "image/png", "image/gif"],
    notes: "Posts to the member's own profile. Videos are MP4, 75 KB to 500 MB. Up to 20 images show as a gallery.",
  },
  bluesky: {
    post_types: ["text", "image", "video"],
    caption_max_chars: 300,
    video_max_seconds: 180,
    carousel_max_items: 4,
    image_types: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    notes: "Up to 300 characters. Up to 4 images (larger ones are resized to Bluesky's 1 MB limit), or one MP4 video of up to 3 minutes and 100 MB. Links, mentions and hashtags become clickable.",
  },
  x: {
    post_types: ["text", "image", "video"],
    caption_max_chars: 280,
    video_max_seconds: 140,
    carousel_max_items: 4,
    image_types: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    notes: "Up to 280 characters (links count as 23). Up to 4 images of up to 5 MB, or one MP4 video of up to 2 min 20 s. X charges per post: about 1.5 cents, or 20 cents if the post has a link.",
  },
};

async function json(response: Response, what: string) {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep empty
  }
  const error = body.error as { code?: string; message?: string } | string | undefined;
  const platformOk = !error || (typeof error === "object" && error.code === "ok");
  if (!response.ok || !platformOk) {
    const message = typeof error === "object" ? error.message : typeof body.error_description === "string" ? body.error_description : undefined;
    throw new PlatformError(`${what} failed${message ? `: ${message}` : ` (${response.status})`}.`, typeof error === "object" && error.code ? String(error.code) : `http_${response.status}`);
  }
  return body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const inSeconds = (seconds: unknown) => (seconds ? new Date(Date.now() + Number(seconds) * 1000) : undefined);

export function authorizeUrl(platform: Platform, state: string, redirectUri: string, setting: Settings) {
  let url: URL;
  switch (platform) {
    case "tiktok":
      url = new URL("https://www.tiktok.com/v2/auth/authorize/");
      url.searchParams.set("client_key", setting("TIKTOK_CLIENT_KEY"));
      url.searchParams.set("scope", scopesFor("tiktok", setting).join(","));
      break;
    case "instagram":
      url = new URL("https://www.instagram.com/oauth/authorize");
      url.searchParams.set("client_id", setting("INSTAGRAM_APP_ID"));
      url.searchParams.set("scope", scopesFor("instagram", setting).join(","));
      break;
    case "facebook":
      url = new URL(`https://www.facebook.com/${META_VERSION}/dialog/oauth`);
      url.searchParams.set("client_id", setting("META_APP_ID"));
      url.searchParams.set("scope", scopesFor("facebook", setting).join(","));
      url.searchParams.set("config_id", setting("META_LOGIN_CONFIG_ID"));
      url.searchParams.set("override_default_response_type", "true");
      break;
    case "threads":
      url = new URL("https://threads.net/oauth/authorize");
      url.searchParams.set("client_id", setting("THREADS_APP_ID"));
      url.searchParams.set("scope", scopesFor("threads", setting).join(","));
      break;
    case "youtube":
      url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", setting("GOOGLE_CLIENT_ID"));
      url.searchParams.set("scope", scopesFor("youtube", setting).join(" "));
      // offline + consent makes Google return a refresh token every time.
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "false");
      break;
    case "linkedin":
      url = new URL("https://www.linkedin.com/oauth/v2/authorization");
      url.searchParams.set("client_id", setting("LINKEDIN_CLIENT_ID"));
      url.searchParams.set("scope", scopesFor("linkedin", setting).join(" "));
      break;
    case "bluesky":
      // Bluesky's sign-in starts with a pushed request (atproto.ts startSignIn).
      throw new PlatformError("Bluesky sign-in is started with startSignIn.");
    case "x":
      // X needs a PKCE verifier kept with the state (x.ts startXSignIn).
      throw new PlatformError("X sign-in is started with startXSignIn.");
  }
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(platform: Platform, code: string, redirectUri: string, setting: Settings, http: typeof fetch = fetch): Promise<Identity[]> {
  if (platform === "bluesky") throw new PlatformError("Bluesky sign-in is finished with finishSignIn.");
  if (platform === "x") throw new PlatformError("X sign-in is finished with finishXSignIn.");
  const form = (fields: Record<string, string>) => ({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });

  if (platform === "tiktok") {
    const token = await json(
      await http("https://open.tiktokapis.com/v2/oauth/token/", form({
        client_key: setting("TIKTOK_CLIENT_KEY"), client_secret: setting("TIKTOK_CLIENT_SECRET"), code, grant_type: "authorization_code", redirect_uri: redirectUri,
      })),
      "TikTok sign-in",
    );
    const creator = await json(
      await http("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json; charset=UTF-8" },
      }),
      "Reading the TikTok account",
    );
    const info = creator.data ?? {};
    return [{
      externalAccountId: String(token.open_id),
      handle: String(info.creator_username ?? info.creator_nickname ?? "tiktok"),
      displayName: String(info.creator_nickname ?? info.creator_username ?? "TikTok account"),
      avatarUrl: info.creator_avatar_url,
      scopes: String(token.scope ?? SCOPES.tiktok.join(",")).split(","),
      tokens: { accessToken: token.access_token, refreshToken: token.refresh_token },
      accessTokenExpiresAt: inSeconds(token.expires_in),
      refreshTokenExpiresAt: inSeconds(token.refresh_expires_in),
      capabilities: { ...CAPABILITIES.tiktok, video_max_seconds: Number(info.max_video_post_duration_sec) || CAPABILITIES.tiktok.video_max_seconds },
    }];
  }

  if (platform === "instagram") {
    const short = await json(
      await http("https://api.instagram.com/oauth/access_token", form({
        client_id: setting("INSTAGRAM_APP_ID"), client_secret: setting("INSTAGRAM_APP_SECRET"), grant_type: "authorization_code", redirect_uri: redirectUri, code,
      })),
      "Instagram sign-in",
    );
    const longUrl = new URL("https://graph.instagram.com/access_token");
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", setting("INSTAGRAM_APP_SECRET"));
    longUrl.searchParams.set("access_token", short.access_token);
    const long = await json(await http(longUrl), "Getting a long-lived Instagram token");
    const accessToken = long.access_token ?? short.access_token;
    const profileUrl = new URL(`https://graph.instagram.com/${META_VERSION}/me`);
    profileUrl.searchParams.set("fields", "id,user_id,username,name,profile_picture_url");
    profileUrl.searchParams.set("access_token", accessToken);
    const profile = await json(await http(profileUrl), "Reading the Instagram account");
    const externalId = String(profile.id ?? profile.user_id ?? short.user_id ?? "");
    if (!externalId) throw new PlatformError("Instagram did not return a professional account. Switch the account to Business or Creator and try again.");
    return [{
      externalAccountId: externalId,
      ownerExternalId: externalId,
      handle: String(profile.username ?? profile.name ?? "instagram"),
      displayName: String(profile.name ?? profile.username ?? "Instagram account"),
      avatarUrl: profile.profile_picture_url,
      scopes: SCOPES.instagram,
      tokens: { accessToken },
      accessTokenExpiresAt: inSeconds(long.expires_in),
      capabilities: CAPABILITIES.instagram,
    }];
  }

  if (platform === "facebook") {
    const graph = (path: string, params: Record<string, string>) => {
      const url = new URL(`https://graph.facebook.com/${META_VERSION}/${path}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return url;
    };
    const short = await json(
      await http(graph("oauth/access_token", { client_id: setting("META_APP_ID"), client_secret: setting("META_APP_SECRET"), redirect_uri: redirectUri, code })),
      "Facebook sign-in",
    );
    const user = await json(
      await http(graph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: setting("META_APP_ID"), client_secret: setting("META_APP_SECRET"), fb_exchange_token: short.access_token })),
      "Getting a long-lived Facebook token",
    );
    const me = await json(await http(graph("me", { fields: "id", access_token: user.access_token })), "Reading the Facebook account");
    const pages = await json(await http(graph("me/accounts", { fields: "id,name,access_token,tasks,picture", access_token: user.access_token })), "Listing Facebook Pages");
    const candidates = (Array.isArray(pages.data) ? pages.data : []) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const usable = candidates.filter((page) => typeof page.access_token === "string" && page.access_token);
    if (!usable.length) {
      throw new PlatformError(
        candidates.length
          ? `Meta returned ${candidates.length} Facebook Page(s), but none allow posting. Reconnect and give Post Social access to manage a Page.`
          : "Meta connected but shared no Facebook Pages. Reconnect and choose at least one Page in Edit settings.",
      );
    }
    // Page tokens from a long-lived user token do not expire.
    return usable.map((page) => ({
      externalAccountId: String(page.id),
      ownerExternalId: String(me.id),
      handle: String(page.name),
      displayName: String(page.name),
      avatarUrl: page.picture?.data?.url,
      scopes: SCOPES.facebook,
      tokens: { accessToken: page.access_token },
      capabilities: CAPABILITIES.facebook,
    }));
  }

  if (platform === "threads") {
    const short = await json(
      await http("https://graph.threads.net/oauth/access_token", form({
        client_id: setting("THREADS_APP_ID"), client_secret: setting("THREADS_APP_SECRET"), grant_type: "authorization_code", redirect_uri: redirectUri, code,
      })),
      "Threads sign-in",
    );
    const longUrl = new URL("https://graph.threads.net/access_token");
    longUrl.searchParams.set("grant_type", "th_exchange_token");
    longUrl.searchParams.set("client_secret", setting("THREADS_APP_SECRET"));
    longUrl.searchParams.set("access_token", short.access_token);
    const long = await json(await http(longUrl), "Getting a long-lived Threads token");
    const accessToken = long.access_token ?? short.access_token;
    const profileUrl = new URL("https://graph.threads.net/v1.0/me");
    profileUrl.searchParams.set("fields", "id,username,threads_profile_picture_url");
    profileUrl.searchParams.set("access_token", accessToken);
    const profile = await json(await http(profileUrl), "Reading the Threads account");
    const externalId = String(profile.id ?? short.user_id ?? "");
    if (!externalId) throw new PlatformError("Threads did not return an account.");
    const username = String(profile.username ?? "threads");
    return [{
      externalAccountId: externalId,
      ownerExternalId: externalId,
      handle: username,
      displayName: username,
      avatarUrl: profile.threads_profile_picture_url,
      scopes: SCOPES.threads,
      tokens: { accessToken },
      accessTokenExpiresAt: inSeconds(long.expires_in),
      capabilities: CAPABILITIES.threads,
    }];
  }

  if (platform === "linkedin") {
    const token = await json(
      await http("https://www.linkedin.com/oauth/v2/accessToken", form({
        grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: setting("LINKEDIN_CLIENT_ID"), client_secret: setting("LINKEDIN_CLIENT_SECRET"),
      })),
      "LinkedIn sign-in",
    );
    const profile = await json(
      await http("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } }),
      "Reading the LinkedIn profile",
    );
    // `sub` is the member id that posts are authored as (urn:li:person:{sub}).
    const externalId = String(profile.sub ?? "");
    if (!externalId) throw new PlatformError("LinkedIn did not return a profile.");
    const name = String(profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(" ")).trim() || "LinkedIn member";
    return [{
      externalAccountId: externalId,
      ownerExternalId: externalId,
      // LinkedIn doesn't share the profile's public address with these permissions.
      handle: name,
      displayName: name,
      avatarUrl: typeof profile.picture === "string" ? profile.picture : undefined,
      scopes: String(token.scope ?? SCOPES.linkedin.join(" ")).split(/[ ,]+/).filter(Boolean),
      tokens: { accessToken: token.access_token, refreshToken: token.refresh_token },
      accessTokenExpiresAt: inSeconds(token.expires_in),
      refreshTokenExpiresAt: inSeconds(token.refresh_token_expires_in),
      capabilities: CAPABILITIES.linkedin,
    }];
  }

  // YouTube. The youtube.upload scope cannot read channel details, so the account is
  // shown as "YouTube channel" and keyed by the Google grant (see completeConnection).
  const tokens = await json(
    await http("https://oauth2.googleapis.com/token", form({
      code, client_id: setting("GOOGLE_CLIENT_ID"), client_secret: setting("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri, grant_type: "authorization_code",
    })),
    "YouTube sign-in",
  );
  if (!tokens.refresh_token) {
    throw new PlatformError("Google did not return lasting access. Remove Post Social at myaccount.google.com/permissions, then connect again.");
  }
  return [{
    externalAccountId: "",
    handle: "youtube",
    displayName: "YouTube channel",
    scopes: String(tokens.scope ?? SCOPES.youtube.join(" ")).split(" "),
    tokens: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token },
    // Refresh five minutes early.
    accessTokenExpiresAt: new Date(Date.now() + (Number(tokens.expires_in) - 300) * 1000),
    capabilities: CAPABILITIES.youtube,
  }];
}

// The account's current profile picture link, asked fresh from the platform (the links
// are signed and expire within days, so a saved one can't be reused). Null when the
// platform shares no picture with our permissions (YouTube upload-only access).
export async function currentAvatarUrl(platform: Platform, externalAccountId: string, accessToken: string, http: typeof fetch = fetch): Promise<string | null> {
  if (platform === "bluesky") return (await publicProfile(http, externalAccountId)).avatar;
  // X picture links don't expire, and reading the profile costs money: the saved one is used.
  if (platform === "x") return null;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  if (platform === "instagram" || platform === "threads") {
    const url = platform === "instagram" ? new URL(`https://graph.instagram.com/${META_VERSION}/me`) : new URL("https://graph.threads.net/v1.0/me");
    url.searchParams.set("fields", platform === "instagram" ? "profile_picture_url" : "threads_profile_picture_url");
    url.searchParams.set("access_token", accessToken);
    const profile = await json(await http(url), `Reading the ${DISPLAY_NAMES[platform]} picture`);
    return text(platform === "instagram" ? profile.profile_picture_url : profile.threads_profile_picture_url);
  }
  if (platform === "facebook") {
    const url = new URL(`https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(externalAccountId)}/picture`);
    url.searchParams.set("redirect", "0");
    url.searchParams.set("type", "large");
    url.searchParams.set("access_token", accessToken);
    const picture = await json(await http(url), "Reading the Facebook Page picture");
    return text(picture.data?.url);
  }
  if (platform === "tiktok") {
    const creator = await json(
      await http("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      }),
      "Reading the TikTok picture",
    );
    return text(creator.data?.creator_avatar_url);
  }
  if (platform === "linkedin") {
    const profile = await json(await http("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } }), "Reading the LinkedIn picture");
    return text(profile.picture);
  }
  return null;
}

export type Refreshed = { tokens: TokenSet; accessTokenExpiresAt?: Date; refreshTokenExpiresAt?: Date };

export async function refreshTokens(platform: Platform, current: TokenSet, setting: Settings, http: typeof fetch = fetch): Promise<Refreshed | null> {
  if (platform === "x") {
    // As for Bluesky, the expiry is kept with the tokens and renewed when used.
    try {
      return { tokens: await refreshX(setting, http, current) };
    } catch (error) {
      throw new PlatformError(error instanceof Error ? error.message : "Renewing X access failed.", (error as { code?: string }).code ?? "platform_error");
    }
  }
  if (platform === "bluesky") {
    // The access expiry lives in the session, not in credentials.access_token_expires_at,
    // so the refresh sweep leaves Bluesky alone; accounts are renewed when used.
    try {
      return { tokens: await refreshSession(setting, http, current as unknown as BlueskySession) };
    } catch (error) {
      throw new PlatformError(error instanceof Error ? error.message : "Renewing Bluesky access failed.", (error as { code?: string }).code ?? "platform_error");
    }
  }
  if (platform === "facebook") return null; // Page tokens do not expire.
  if (platform === "linkedin") {
    // Most apps get no refresh token: access lasts 60 days, then the person reconnects.
    if (!current.refreshToken) return null;
    const token = await json(
      await http("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: setting("LINKEDIN_CLIENT_ID"), client_secret: setting("LINKEDIN_CLIENT_SECRET") }),
      }),
      "Refreshing LinkedIn access",
    );
    return {
      tokens: { accessToken: token.access_token, refreshToken: token.refresh_token ?? current.refreshToken },
      accessTokenExpiresAt: inSeconds(token.expires_in),
      refreshTokenExpiresAt: inSeconds(token.refresh_token_expires_in),
    };
  }
  if (platform === "tiktok") {
    if (!current.refreshToken) throw new PlatformError("TikTok refresh token is missing.");
    const token = await json(
      await http("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: setting("TIKTOK_CLIENT_KEY"), client_secret: setting("TIKTOK_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: current.refreshToken }),
      }),
      "Refreshing TikTok access",
    );
    return {
      tokens: { accessToken: token.access_token, refreshToken: token.refresh_token ?? current.refreshToken },
      accessTokenExpiresAt: inSeconds(token.expires_in),
      refreshTokenExpiresAt: inSeconds(token.refresh_expires_in),
    };
  }
  if (platform === "instagram" || platform === "threads") {
    const url = platform === "instagram" ? new URL("https://graph.instagram.com/refresh_access_token") : new URL("https://graph.threads.net/refresh_access_token");
    url.searchParams.set("grant_type", platform === "instagram" ? "ig_refresh_token" : "th_refresh_token");
    url.searchParams.set("access_token", current.accessToken);
    const token = await json(await http(url), `Refreshing ${DISPLAY_NAMES[platform]} access`);
    return { tokens: { accessToken: token.access_token }, accessTokenExpiresAt: inSeconds(token.expires_in) };
  }
  if (!current.refreshToken) throw new PlatformError("YouTube refresh token is missing.");
  const token = await json(
    await http("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: current.refreshToken, client_id: setting("GOOGLE_CLIENT_ID"), client_secret: setting("GOOGLE_CLIENT_SECRET"), grant_type: "refresh_token" }),
    }),
    "Refreshing YouTube access",
  );
  return {
    tokens: { accessToken: token.access_token, refreshToken: current.refreshToken },
    accessTokenExpiresAt: new Date(Date.now() + (Number(token.expires_in) - 300) * 1000),
  };
}

// Revokes access at the platform. Returns a short outcome code; never throws.
export async function revokeTokens(platform: Platform, tokens: TokenSet, setting: Settings, http: typeof fetch = fetch): Promise<string> {
  try {
    if (platform === "bluesky") return await revokeSession(setting, http, tokens as unknown as BlueskySession);
    if (platform === "x") return await revokeX(setting, http, tokens);
    let response: Response;
    if (platform === "youtube") {
      // Revoking the refresh token ends the whole Google grant, as the privacy policy says.
      response = await http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refreshToken ?? tokens.accessToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } else if (platform === "tiktok") {
      response = await http("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: setting("TIKTOK_CLIENT_KEY"), client_secret: setting("TIKTOK_CLIENT_SECRET"), token: tokens.accessToken }),
      });
    } else if (platform === "linkedin") {
      response = await http("https://www.linkedin.com/oauth/v2/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: setting("LINKEDIN_CLIENT_ID"), client_secret: setting("LINKEDIN_CLIENT_SECRET"), token: tokens.accessToken }),
      });
    } else {
      const host = platform === "instagram" ? "https://graph.instagram.com" : platform === "threads" ? "https://graph.threads.net/v1.0" : `https://graph.facebook.com/${META_VERSION}`;
      response = await http(`${host}/me/permissions`, { method: "DELETE", headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    }
    return response.ok ? "confirmed" : `platform_http_${response.status}`;
  } catch {
    return "platform_unreachable";
  }
}
