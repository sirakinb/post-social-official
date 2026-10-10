// Bluesky (AT Protocol) OAuth for a confidential web client: pushed authorization
// requests, PKCE, DPoP-bound tokens and private_key_jwt client authentication
// (https://atproto.com/specs/oauth). Runtime-neutral: Web Crypto and fetch only, so it runs
// in the connections function (Deno), the worker (Node) and tests.
//
// Our client id is the address of our client metadata, served by the connections function.
// Tokens are bound to a per-account DPoP key, so the key, the authorization server and the
// account's PDS are stored with the tokens.
import { randomToken } from "./crypto";

export class AtprotoError extends Error {
  constructor(message: string, public code = "bluesky_error") {
    super(message);
  }
}

export type Settings = (name: string) => string;

// Broad posting access (create posts, upload images and videos). The granular scopes in the
// permission spec are not yet accepted everywhere.
export const BLUESKY_SCOPE = "atproto transition:generic";
// Accounts are looked up here when the person gives no handle (bsky.social hosts most).
export const DEFAULT_ENTRYWAY = "https://bsky.social";
export const PUBLIC_APPVIEW = "https://public.api.bsky.app";

export const clientId = (setting: Settings) => `${setting("CONNECTIONS_BASE_URL")}/oauth/bluesky/client-metadata.json`;

export type PrivateJwk = JsonWebKey & { kid: string };

// The client's signing key, an ES256 private JWK in the BLUESKY_CLIENT_JWK secret.
export function clientKey(setting: Settings): PrivateJwk {
  let jwk: PrivateJwk;
  try {
    jwk = JSON.parse(setting("BLUESKY_CLIENT_JWK"));
  } catch {
    throw new AtprotoError("Bluesky is not set up on this server yet (BLUESKY_CLIENT_JWK).", "not_configured");
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) throw new AtprotoError("BLUESKY_CLIENT_JWK must be an ES256 private key with a kid.", "not_configured");
  return jwk;
}

export function publicJwk({ kty, crv, x, y, kid }: PrivateJwk) {
  return { kty, crv, x, y, kid, use: "sig", alg: "ES256" };
}

export function clientMetadata(setting: Settings, redirectUri: string) {
  const id = clientId(setting);
  return {
    client_id: id,
    client_name: "Post Social",
    application_type: "web",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: [redirectUri],
    scope: BLUESKY_SCOPE,
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "ES256",
    jwks_uri: id.replace(/client-metadata\.json$/, "jwks.json"),
    dpop_bound_access_tokens: true,
  };
}

// ---------- JWTs ----------

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64json = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));

async function sha256b64url(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, jwk: JsonWebKey) {
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const input = `${b64json({ alg: "ES256", ...header })}.${b64json(payload)}`;
  // Web Crypto returns the raw r||s signature, which is what JWS wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(input)));
  return `${input}.${base64url(signature)}`;
}

export async function newDpopKey(): Promise<JsonWebKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return crypto.subtle.exportKey("jwk", pair.privateKey);
}

async function dpopProof(jwk: JsonWebKey, method: string, url: string, nonce?: string, accessToken?: string) {
  const { kty, crv, x, y } = jwk;
  const target = new URL(url);
  const payload: Record<string, unknown> = { jti: randomToken(16), htm: method, htu: `${target.origin}${target.pathname}`, iat: Math.floor(Date.now() / 1000) };
  if (nonce) payload.nonce = nonce;
  if (accessToken) payload.ath = await sha256b64url(accessToken);
  return signJwt({ typ: "dpop+jwt", jwk: { kty, crv, x, y } }, payload, jwk);
}

async function clientAssertion(setting: Settings, audience: string) {
  const key = clientKey(setting);
  const id = clientId(setting);
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ kid: key.kid }, { iss: id, sub: id, aud: audience, jti: randomToken(16), iat: now, exp: now + 60 }, key);
}

// A request with a DPoP proof, retried once with the server's nonce when it asks for one.
// Returns the response and the server's latest nonce.
export async function dpopFetch(
  http: typeof fetch,
  jwk: JsonWebKey,
  url: string,
  init: RequestInit & { method: string },
  options: { nonce?: string; accessToken?: string } = {},
): Promise<{ response: Response; nonce?: string }> {
  let nonce = options.nonce;
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(init.headers);
    headers.set("DPoP", await dpopProof(jwk, init.method, url, nonce, options.accessToken));
    if (options.accessToken) headers.set("Authorization", `DPoP ${options.accessToken}`);
    const response = await http(url, { ...init, headers });
    const fresh = response.headers.get("DPoP-Nonce") ?? undefined;
    if (attempt === 0 && fresh && fresh !== nonce && (response.status === 400 || response.status === 401) && (await asksForNonce(response.clone()))) {
      nonce = fresh;
      continue;
    }
    return { response, nonce: fresh ?? nonce };
  }
  throw new AtprotoError("Bluesky kept asking for a new security nonce.");
}

async function asksForNonce(response: Response) {
  if (/use_dpop_nonce/.test(response.headers.get("WWW-Authenticate") ?? "")) return true;
  const body = await response.json().catch(() => ({}));
  return (body as { error?: string }).error === "use_dpop_nonce";
}

async function readJson(response: Response, what: string) {
  const body = (await response.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!response.ok) {
    const detail = body.error_description ?? body.message ?? body.error;
    throw new AtprotoError(`${what} failed${detail ? `: ${detail}` : ` (${response.status})`}.`, body.error ? String(body.error) : `http_${response.status}`);
  }
  return body;
}

// ---------- Identity and server discovery ----------

// Only plain public https addresses are fetched: handles, DID documents and server metadata
// come from outside, and must not point us at internal hosts.
export function safeHttpsUrl(value: unknown, what: string) {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new AtprotoError(`${what} is not a valid address.`);
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || url.username || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(^|\.)(localhost|local|internal)$/.test(host)) {
    throw new AtprotoError(`${what} is not a public https address.`);
  }
  return url;
}

export function normalizeHandle(value: unknown) {
  const handle = String(value ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!handle) return null;
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(handle) || handle.length > 253) {
    throw new AtprotoError("That doesn't look like a Bluesky handle (for example name.bsky.social).", "invalid_handle");
  }
  return handle;
}

export async function resolveHandle(http: typeof fetch, handle: string) {
  const url = new URL(`${PUBLIC_APPVIEW}/xrpc/com.atproto.identity.resolveHandle`);
  url.searchParams.set("handle", handle);
  const body = await readJson(await http(url), `Looking up @${handle}`);
  if (typeof body.did !== "string" || !body.did.startsWith("did:")) throw new AtprotoError(`Bluesky has no account @${handle}.`, "unknown_handle");
  return body.did as string;
}

// The account's PDS (where its posts live) and the handle its DID document claims.
export async function resolveDid(http: typeof fetch, did: string) {
  let docUrl: string;
  if (/^did:plc:[a-z2-7]{24}$/.test(did)) docUrl = `https://plc.directory/${did}`;
  else if (/^did:web:[a-z0-9.-]+$/i.test(did)) docUrl = `${safeHttpsUrl(`https://${did.slice(8)}`, "The account's server").origin}/.well-known/did.json`;
  else throw new AtprotoError("Bluesky returned an account id we can't use.");
  const doc = await readJson(await http(docUrl), "Reading the Bluesky account");
  const service = (doc.service as Array<{ id?: string; type?: string; serviceEndpoint?: string }> | undefined)?.find((s) => s.id?.endsWith("#atproto_pds"));
  if (!service?.serviceEndpoint) throw new AtprotoError("This Bluesky account has no server listed.");
  const pds = safeHttpsUrl(service.serviceEndpoint, "The account's server").origin;
  const alias = (doc.alsoKnownAs as string[] | undefined)?.find((a) => a.startsWith("at://"));
  return { pds, handle: alias ? alias.slice(5) : null };
}

export type AuthServer = { issuer: string; par: string; authorization: string; token: string; revocation?: string };

async function authServerFor(http: typeof fetch, origin: string): Promise<AuthServer> {
  // A PDS points at its authorization server; an entryway like bsky.social is one itself.
  let issuer = origin;
  const resource = await http(`${origin}/.well-known/oauth-protected-resource`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const listed = (resource as { authorization_servers?: string[] } | null)?.authorization_servers?.[0];
  if (listed) issuer = safeHttpsUrl(listed, "The Bluesky sign-in server").origin;
  const meta = await readJson(await http(`${issuer}/.well-known/oauth-authorization-server`), "Reading the Bluesky sign-in server");
  if (meta.issuer !== issuer) throw new AtprotoError("The Bluesky sign-in server did not identify itself correctly.");
  const endpoint = (name: string) => safeHttpsUrl(meta[name], "A Bluesky sign-in address").toString();
  return {
    issuer,
    par: endpoint("pushed_authorization_request_endpoint"),
    authorization: endpoint("authorization_endpoint"),
    token: endpoint("token_endpoint"),
    revocation: meta.revocation_endpoint ? endpoint("revocation_endpoint") : undefined,
  };
}

// ---------- Sign-in ----------

// Kept (encrypted) with the sign-in state until the person comes back.
export type PendingSignIn = { verifier: string; dpopJwk: JsonWebKey; nonce?: string; server: AuthServer; did?: string };

export async function startSignIn(setting: Settings, http: typeof fetch, state: string, redirectUri: string, handleInput?: unknown) {
  const handle = normalizeHandle(handleInput);
  let did: string | undefined;
  let server: AuthServer;
  if (handle) {
    did = await resolveHandle(http, handle);
    const { pds } = await resolveDid(http, did);
    server = await authServerFor(http, pds);
  } else {
    server = await authServerFor(http, DEFAULT_ENTRYWAY);
  }

  const verifier = randomToken(32);
  const dpopJwk = await newDpopKey();
  const body = new URLSearchParams({
    client_id: clientId(setting),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: BLUESKY_SCOPE,
    state,
    code_challenge: await sha256b64url(verifier),
    code_challenge_method: "S256",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await clientAssertion(setting, server.issuer),
  });
  if (handle) body.set("login_hint", handle);
  const { response, nonce } = await dpopFetch(http, dpopJwk, server.par, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const par = await readJson(response, "Starting the Bluesky sign-in");
  if (typeof par.request_uri !== "string") throw new AtprotoError("Bluesky did not start the sign-in.");

  const url = new URL(server.authorization);
  url.searchParams.set("client_id", clientId(setting));
  url.searchParams.set("request_uri", par.request_uri);
  const pending: PendingSignIn = { verifier, dpopJwk, nonce, server, did };
  return { url: url.toString(), pending };
}

// What is stored (encrypted) for a connected Bluesky account.
export type BlueskySession = {
  accessToken: string;
  refreshToken?: string;
  dpopJwk: JsonWebKey;
  nonce?: string; // the sign-in server's latest DPoP nonce
  pdsNonce?: string; // the PDS's
  server: AuthServer;
  did: string;
  pds: string;
  accessExpiresAt: number; // epoch ms
};

async function tokenRequest(setting: Settings, http: typeof fetch, server: AuthServer, jwk: JsonWebKey, nonce: string | undefined, fields: Record<string, string>, what: string) {
  const { response, nonce: latest } = await dpopFetch(http, jwk, server.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...fields,
      client_id: clientId(setting),
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await clientAssertion(setting, server.issuer),
    }),
  }, { nonce });
  const token = await readJson(response, what);
  if (token.token_type !== "DPoP" || typeof token.access_token !== "string" || typeof token.sub !== "string") throw new AtprotoError(`${what} returned an unexpected answer.`);
  if (!String(token.scope ?? "").split(" ").includes("atproto")) throw new AtprotoError("Bluesky did not grant posting access.", "scope_missing");
  return { token, nonce: latest };
}

const expiresAt = (seconds: unknown) => Date.now() + Math.max(60, Number(seconds) || 300) * 1000 - 30_000;

export async function finishSignIn(setting: Settings, http: typeof fetch, pending: PendingSignIn, params: URLSearchParams, redirectUri: string) {
  // The callback must come from the server the sign-in started with.
  if (params.get("iss") !== pending.server.issuer) throw new AtprotoError("This Bluesky sign-in came back from an unexpected server. Start again.");
  const code = params.get("code");
  if (!code) throw new AtprotoError("Bluesky did not return a sign-in code. Start again.");
  const { token, nonce } = await tokenRequest(setting, http, pending.server, pending.dpopJwk, pending.nonce, {
    grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: pending.verifier,
  }, "Bluesky sign-in");
  const did = String(token.sub);
  if (pending.did && pending.did !== did) throw new AtprotoError("You signed in to a different Bluesky account than the one you entered. Start again.");
  // The account must really be served by the server that signed it in.
  const { pds, handle } = await resolveDid(http, did);
  if (!pending.did) {
    const server = await authServerFor(http, pds);
    if (server.issuer !== pending.server.issuer) throw new AtprotoError("This Bluesky account is not managed by the server that signed it in.");
  }
  const session: BlueskySession = {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : undefined,
    dpopJwk: pending.dpopJwk,
    nonce,
    server: pending.server,
    did,
    pds,
    accessExpiresAt: expiresAt(token.expires_in),
  };
  return { session, handle, scope: String(token.scope ?? BLUESKY_SCOPE) };
}

// Bluesky refresh tokens are single-use: the caller must save the returned session (with
// its new refresh token) before anyone refreshes again.
export async function refreshSession(setting: Settings, http: typeof fetch, session: BlueskySession): Promise<BlueskySession> {
  if (!session.refreshToken) throw new AtprotoError("Bluesky access ran out and there is nothing to renew it with.", "invalid_grant");
  const { token, nonce } = await tokenRequest(setting, http, session.server, session.dpopJwk, session.nonce, {
    grant_type: "refresh_token", refresh_token: session.refreshToken,
  }, "Renewing Bluesky access");
  if (token.sub !== session.did) throw new AtprotoError("Bluesky renewed access for a different account.");
  return {
    ...session,
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : session.refreshToken,
    nonce,
    accessExpiresAt: expiresAt(token.expires_in),
  };
}

export async function revokeSession(setting: Settings, http: typeof fetch, session: BlueskySession) {
  if (!session.server.revocation) return "not_supported";
  const token = session.refreshToken ?? session.accessToken;
  const { response } = await dpopFetch(http, session.dpopJwk, session.server.revocation, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      client_id: clientId(setting),
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await clientAssertion(setting, session.server.issuer),
    }),
  }, { nonce: session.nonce });
  return response.ok ? "confirmed" : `platform_http_${response.status}`;
}

// A call to the account's PDS (or another atproto service) with its DPoP-bound token.
// Returns the response and the PDS's latest nonce, which the caller may keep.
export async function pdsFetch(http: typeof fetch, session: BlueskySession, url: string, init: RequestInit & { method: string }) {
  return dpopFetch(http, session.dpopJwk, url, init, { accessToken: session.accessToken, nonce: session.pdsNonce });
}

// The public profile (name and picture). No sign-in needed.
export async function publicProfile(http: typeof fetch, did: string) {
  const url = new URL(`${PUBLIC_APPVIEW}/xrpc/app.bsky.actor.getProfile`);
  url.searchParams.set("actor", did);
  const profile = await readJson(await http(url), "Reading the Bluesky profile");
  return {
    handle: typeof profile.handle === "string" ? profile.handle : null,
    displayName: typeof profile.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : null,
    avatar: typeof profile.avatar === "string" ? profile.avatar : null,
  };
}
