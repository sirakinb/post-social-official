// X (Twitter) sign-in: OAuth 2.0 with PKCE as a confidential client (X_CLIENT_ID and
// X_CLIENT_SECRET). Access lasts two hours; each refresh returns a new refresh token and
// retires the old one, so, as for Bluesky, the access expiry is kept with the tokens and
// accounts are renewed when used, one renewal at a time. Runtime-neutral (fetch only).
import { randomToken, type TokenSet } from "./crypto";

export type Settings = (name: string) => string;

export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const AUTHORIZE = "https://x.com/i/oauth2/authorize";
const TOKEN = "https://api.x.com/2/oauth2/token";
const REVOKE = "https://api.x.com/2/oauth2/revoke";

export class XError extends Error {
  constructor(message: string, public code = "x_error") {
    super(message);
  }
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

// Kept (encrypted) with the sign-in state until the person comes back.
export type PendingX = { verifier: string };

export async function startXSignIn(setting: Settings, state: string, redirectUri: string) {
  const verifier = randomToken(48);
  const url = new URL(AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", setting("X_CLIENT_ID"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", X_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), pending: { verifier } satisfies PendingX };
}

// What is stored (encrypted) for a connected X account.
export type XTokens = TokenSet & { accessExpiresAt: number };

async function tokenRequest(setting: Settings, http: typeof fetch, fields: Record<string, string>, what: string) {
  const response = await http(TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${setting("X_CLIENT_ID")}:${setting("X_CLIENT_SECRET")}`)}`,
    },
    body: new URLSearchParams(fields),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!response.ok || typeof body.access_token !== "string") {
    const detail = body.error_description ?? body.error;
    throw new XError(`${what} failed${detail ? `: ${detail}` : ` (${response.status})`}.`, body.error ? String(body.error) : `http_${response.status}`);
  }
  const tokens: XTokens = {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    // Renewed five minutes early.
    accessExpiresAt: Date.now() + (Number(body.expires_in) || 7200) * 1000 - 5 * 60_000,
  };
  return { tokens, scope: String(body.scope ?? X_SCOPES.join(" ")) };
}

export async function finishXSignIn(setting: Settings, http: typeof fetch, pending: PendingX, code: string, redirectUri: string) {
  const { tokens, scope } = await tokenRequest(setting, http, {
    grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: pending.verifier, client_id: setting("X_CLIENT_ID"),
  }, "X sign-in");
  if (!scope.split(" ").includes("tweet.write")) throw new XError("X did not grant posting access. Connect again and allow posting.", "scope_missing");
  // Costs one user read (about a cent) per connection.
  const response = await http("https://api.x.com/2/users/me?user.fields=profile_image_url,name,username", { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  const body = (await response.json().catch(() => ({}))) as { data?: { id?: string; name?: string; username?: string; profile_image_url?: string }; title?: string; detail?: string };
  if (!response.ok || !body.data?.id) throw new XError(`Reading the X profile failed${body.detail ? `: ${body.detail}` : ` (${response.status})`}.`, `http_${response.status}`);
  const user = body.data;
  return {
    tokens,
    scope,
    id: user.id!,
    username: user.username ?? user.id!,
    name: user.name?.trim() || user.username || "X account",
    // The default size is 48 px; _400x400 is the same picture, larger.
    avatar: user.profile_image_url?.replace("_normal.", "_400x400.") ?? null,
  };
}

// X retires the old refresh token as soon as a new one is issued: the caller must save the
// result before anyone renews again.
export async function refreshX(setting: Settings, http: typeof fetch, current: TokenSet): Promise<XTokens> {
  if (!current.refreshToken) throw new XError("X access ran out and there is nothing to renew it with.", "invalid_grant");
  const { tokens } = await tokenRequest(setting, http, { grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: setting("X_CLIENT_ID") }, "Renewing X access");
  return { ...tokens, refreshToken: tokens.refreshToken ?? current.refreshToken };
}

export async function revokeX(setting: Settings, http: typeof fetch, tokens: TokenSet) {
  const response = await http(REVOKE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${setting("X_CLIENT_ID")}:${setting("X_CLIENT_SECRET")}`)}`,
    },
    body: new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken, token_type_hint: tokens.refreshToken ? "refresh_token" : "access_token" }),
  });
  return response.ok ? "confirmed" : `platform_http_${response.status}`;
}

// X counts characters by weight: most Latin text is 1, CJK and emoji are 2, and every link
// is 23 whatever its length. A post can weigh at most 280 (more with X Premium).
export function xWeightedLength(text: string) {
  let total = 0;
  const urls = /https?:\/\/[^\s]+/g;
  let last = 0;
  const weigh = (part: string) => {
    const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
    const graphemes = Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(part), (g) => g.segment) : [...part];
    for (const g of graphemes) {
      if (/\p{Extended_Pictographic}/u.test(g)) {
        total += 2;
        continue;
      }
      const cp = g.codePointAt(0)!;
      const light = cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
      total += light ? 1 : 2;
    }
  };
  for (const match of text.matchAll(urls)) {
    weigh(text.slice(last, match.index));
    total += 23;
    last = match.index! + match[0].length;
  }
  weigh(text.slice(last));
  return total;
}

export const hasLink = (text: string) => /https?:\/\/\S+|\b[a-z0-9-]+\.(com|net|org|io|co|xyz|app|dev|ai)\b/i.test(text);
