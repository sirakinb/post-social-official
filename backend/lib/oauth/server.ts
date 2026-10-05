// OAuth 2.1 authorization server for AI apps that connect to the MCP server (ChatGPT, the
// Claude app, Cursor...). Follows the MCP authorization spec: protected resource metadata
// (RFC 9728), authorization server metadata (RFC 8414), dynamic client registration
// (RFC 7591), PKCE S256, resource indicators (RFC 8707), rotating refresh tokens and
// revocation (RFC 7009). Apps are public clients; PKCE is what binds a code to its app.
// Only SHA-256 hashes of codes and tokens are stored.
import { API_LIMIT_SQL, ApiError, apiLimitMessage, isAgentCaller, membership, PLAN_JOIN_SQL, requireUuid, type AgentCaller, type Caller, type Sql } from "../access";
import { randomToken, sha256Hex } from "../connections/crypto";

export const SCOPE = "posts";
const CODE_MINUTES = 10;
const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 60;
const REUSE_GRACE_SECONDS = 60;
const TOKEN_SHAPE = /^ps_at_[A-Za-z0-9_-]{43}$/;

export class OAuthError extends Error {
  constructor(public error: string, public description: string, public status = 400) {
    super(description);
  }
}

export const endpoints = (issuer: string) => ({
  issuer,
  authorize: `${issuer}/oauth/authorize`,
  token: `${issuer}/oauth/token`,
  register: `${issuer}/oauth/register`,
  revoke: `${issuer}/oauth/revoke`,
  mcp: `${issuer}/mcp`,
  api: `${issuer}/api`,
  resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
});

export function authorizationServerMetadata(issuer: string) {
  const e = endpoints(issuer);
  return {
    issuer,
    authorization_endpoint: e.authorize,
    token_endpoint: e.token,
    registration_endpoint: e.register,
    revocation_endpoint: e.revoke,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
    service_documentation: `${issuer}/beta/keys`,
  };
}

export function protectedResourceMetadata(issuer: string) {
  return {
    resource: endpoints(issuer).mcp,
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Post Social",
  };
}

// Tokens are valid for the MCP server and the REST API on this site.
function resourceAllowed(issuer: string, resource: string | null | undefined) {
  if (!resource) return true;
  const e = endpoints(issuer);
  const clean = resource.replace(/\/+$/, "");
  return clean === e.mcp || clean === issuer || clean === e.api || clean === `${e.api}/v1`;
}

// ----- registration -----

// Allowed: https, http only on this computer (loopback), or an app's own scheme
// (cursor://...). Never script, data or file links.
export function redirectUriProblem(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 2000) return "Each redirect_uri must be a link of at most 2000 characters.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${raw} is not a valid link.`;
  }
  if (url.hash) return "redirect_uris cannot contain a fragment.";
  const scheme = url.protocol.replace(/:$/, "");
  if (["javascript", "data", "file", "vbscript", "blob", "about"].includes(scheme)) return `${scheme}: links are not allowed.`;
  if (scheme === "http" && !isLoopback(url.hostname)) return "http links are only allowed for localhost; use https.";
  return null;
}

const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

export async function registerClient(sql: Sql, body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) throw new OAuthError("invalid_redirect_uri", "Send 1 to 10 redirect_uris.");
  for (const uri of uris) {
    const problem = redirectUriProblem(uri);
    if (problem) throw new OAuthError("invalid_redirect_uri", problem);
  }
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
  if (grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "Only the authorization_code and refresh_token grant types are supported.");
  }
  const name = (typeof body.client_name === "string" ? body.client_name.trim() : "").slice(0, 80) || "An AI app";
  const clientUri = typeof body.client_uri === "string" && /^https:\/\//.test(body.client_uri) ? body.client_uri.slice(0, 500) : null;
  const clientId = `psc_${randomToken(16)}`;
  const [row] = await sql<{ created_at: string }>(
    `INSERT INTO public.oauth_clients (client_id, client_name, redirect_uris, client_uri) VALUES ($1, $2, $3, $4) RETURNING created_at`,
    [clientId, name, uris, clientUri],
  );
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.parse(row.created_at) / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...(clientUri ? { client_uri: clientUri } : {}),
  };
}

// ----- authorization (the consent page) -----

type ClientRow = { id: string; client_id: string; client_name: string; redirect_uris: string[]; client_uri: string | null };

// Loopback redirects may use any port (RFC 8252); everything else must match exactly.
export function redirectMatches(registered: string[], requested: string) {
  if (registered.includes(requested)) return true;
  let asked: URL;
  try {
    asked = new URL(requested);
  } catch {
    return false;
  }
  if (asked.protocol !== "http:" || !isLoopback(asked.hostname)) return false;
  return registered.some((r) => {
    try {
      const reg = new URL(r);
      return reg.protocol === "http:" && reg.hostname === asked.hostname && reg.pathname === asked.pathname && reg.search === asked.search;
    } catch {
      return false;
    }
  });
}

export type AuthorizeParams = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
};

// Problems that make it unsafe to send the person back to the app are shown on the page
// (bad client or redirect). Everything else goes back to the app as an OAuth error.
export async function checkAuthorization(sql: Sql, issuer: string, params: AuthorizeParams) {
  if (!params.client_id) throw new OAuthError("invalid_request", "This sign-in link is missing the app's id.");
  const [client] = await sql<ClientRow>(`SELECT id, client_id, client_name, redirect_uris, client_uri FROM public.oauth_clients WHERE client_id = $1`, [params.client_id]);
  if (!client) throw new OAuthError("invalid_client", "This app is not registered with Post Social. Try connecting again from the app.");
  if (!params.redirect_uri || !redirectMatches(client.redirect_uris, params.redirect_uri)) {
    throw new OAuthError("invalid_request", "This sign-in link sends you to an address the app did not register, so it was stopped.");
  }
  const back = (error: string, description: string) => ({ client, redirect: errorRedirect(params, error, description, issuer) });
  if (params.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (!params.code_challenge || params.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  if (!resourceAllowed(issuer, params.resource)) return back("invalid_target", "Tokens can only be issued for this Post Social server.");
  const scopes = (params.scope ?? SCOPE).split(" ").filter(Boolean);
  if (scopes.some((s) => s !== SCOPE)) return back("invalid_scope", `The only scope is "${SCOPE}".`);
  return { client, redirect: null };
}

function withParams(redirectUri: string, values: Record<string, string | undefined>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

function errorRedirect(params: AuthorizeParams, error: string, description: string, issuer: string) {
  return withParams(params.redirect_uri!, { error, error_description: description, state: params.state, iss: issuer });
}

type Person = { id: string; name: string };

// The person's answer on the consent page. Returns where to send their browser.
export async function decideAuthorization(sql: Sql, issuer: string, person: Person, params: AuthorizeParams & { workspace_id?: unknown; approve?: unknown }) {
  const { client, redirect } = await checkAuthorization(sql, issuer, params);
  if (redirect) return { redirect };
  if (params.approve !== true) return { redirect: errorRedirect(params, "access_denied", "The person declined.", issuer) };
  const workspaceId = requireUuid(params.workspace_id, "Workspace");
  await membership(sql, { userId: person.id, displayName: person.name, entryPoint: "ui" }, workspaceId, false);
  const code = `ps_ac_${randomToken(32)}`;
  await sql(
    `INSERT INTO public.oauth_codes (code_hash, oauth_client_id, workspace_id, user_id, redirect_uri, code_challenge, resource, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(mins => $9))`,
    [await sha256Hex(code), client.id, workspaceId, person.id, params.redirect_uri, params.code_challenge, params.resource ?? null, [SCOPE], CODE_MINUTES],
  );
  return { redirect: withParams(params.redirect_uri!, { code, state: params.state, iss: issuer }) };
}

// ----- tokens -----

async function s256(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type GrantRow = { id: string; workspace_id: string; user_id: string; client_id: string; client_name: string };

// rotated: a refresh replaced the old token, so seeing it again later means it leaked.
// After a fresh sign-in the old token is simply retired (the app replaced it on purpose).
// usedRefreshHash: on a refresh, the token being exchanged. The swap only happens if it is
// still the current one, so two requests racing with the same token can't both succeed.
async function issueTokens(sql: Sql, grantId: string, workspaceId: string, rotated: boolean, usedRefreshHash: string | null = null) {
  const access = `ps_at_${randomToken(32)}`;
  const refresh = `ps_rt_${randomToken(32)}`;
  const issued = await sql(
    `WITH g AS (
       UPDATE public.oauth_grants
       SET previous_refresh_token_hash = CASE WHEN $7 THEN refresh_token_hash END, refresh_token_hash = $3, refresh_rotated_at = now(),
           refresh_expires_at = now() + make_interval(days => $5), last_used_at = now()
       WHERE id = $1 AND ($8::text IS NULL OR refresh_token_hash = $8)
       RETURNING id
     )
     INSERT INTO public.oauth_access_tokens (token_hash, oauth_grant_id, workspace_id, expires_at)
     SELECT $4, id, $2, now() + make_interval(secs => $6) FROM g
     RETURNING token_hash`,
    [grantId, workspaceId, await sha256Hex(refresh), await sha256Hex(access), REFRESH_DAYS, ACCESS_SECONDS, rotated, usedRefreshHash],
  );
  if (!issued.length) throw new OAuthError("invalid_grant", "This connection has ended. Connect Post Social again.");
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPE };
}

async function stillMember(sql: Sql, workspaceId: string, userId: string) {
  const rows = await sql(`SELECT 1 FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
  return rows.length > 0;
}

export async function exchangeToken(sql: Sql, issuer: string, form: Record<string, string | undefined>) {
  if (form.grant_type === "authorization_code") return exchangeCode(sql, issuer, form);
  if (form.grant_type === "refresh_token") return refreshGrant(sql, issuer, form);
  throw new OAuthError("unsupported_grant_type", "Use grant_type authorization_code or refresh_token.");
}

async function exchangeCode(sql: Sql, issuer: string, form: Record<string, string | undefined>) {
  if (!form.code || !form.code_verifier || !form.client_id || !form.redirect_uri) {
    throw new OAuthError("invalid_request", "Send code, code_verifier, client_id and redirect_uri.");
  }
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(form.code_verifier)) throw new OAuthError("invalid_request", "code_verifier must be 43 to 128 characters.");
  // Single use: the code is marked used in the same step that reads it.
  const [code] = await sql<{ oauth_client_id: string; client_id: string; client_name: string; workspace_id: string; user_id: string; redirect_uri: string; code_challenge: string; resource: string | null; scopes: string[] }>(
    `WITH c AS (
       UPDATE public.oauth_codes SET used_at = now()
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING *
     )
     SELECT c.*, cl.client_id, cl.client_name FROM c JOIN public.oauth_clients cl ON cl.id = c.oauth_client_id`,
    [await sha256Hex(form.code)],
  );
  const invalid = new OAuthError("invalid_grant", "This sign-in code is not valid, has expired or was already used. Connect again.");
  if (!code || code.client_id !== form.client_id || code.redirect_uri !== form.redirect_uri) throw invalid;
  if ((await s256(form.code_verifier)) !== code.code_challenge) throw invalid;
  if (form.resource && (!resourceAllowed(issuer, form.resource) || (code.resource && form.resource.replace(/\/+$/, "") !== code.resource.replace(/\/+$/, "")))) {
    throw new OAuthError("invalid_target", "The resource does not match the one that was approved.");
  }
  if (!(await stillMember(sql, code.workspace_id, code.user_id))) throw invalid;

  // Reconnecting the same app to the same workspace reuses its grant, so its history and
  // name stay together; otherwise the grant and its actor are created now.
  const [grant] = await sql<{ id: string }>(
    `WITH existing AS (
       SELECT id FROM public.oauth_grants
       WHERE workspace_id = $1 AND user_id = $2 AND oauth_client_id = $3 AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1
     ), person AS (
       SELECT coalesce(nullif(display_name, ''), 'a member') AS name FROM public.actors
       WHERE workspace_id = $1 AND user_id = $2 AND kind = 'user' LIMIT 1
     ), created AS (
       INSERT INTO public.oauth_grants (workspace_id, user_id, oauth_client_id, label, scopes)
       SELECT $1, $2, $3, $4 || ', ' || coalesce((SELECT name FROM person), 'a member') || '''s connection', $5
       WHERE NOT EXISTS (SELECT 1 FROM existing)
       RETURNING id, workspace_id
     ), actor AS (
       INSERT INTO public.actors (workspace_id, kind, oauth_grant_id, display_name)
       SELECT workspace_id, 'oauth_grant', id, $4 FROM created
     ), audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary)
       SELECT $1, (SELECT id FROM public.actors WHERE workspace_id = $1 AND user_id = $2 AND kind = 'user' LIMIT 1),
              'ui', 'oauth_grant.created', 'oauth_grant', id, 'Connected ' || $4 || ' (signed in)'
       FROM created
     ), touched AS (
       UPDATE public.oauth_clients SET last_used_at = now() WHERE id = $3
     )
     SELECT id FROM created UNION ALL SELECT id FROM existing`,
    [code.workspace_id, code.user_id, code.oauth_client_id, code.client_name, code.scopes],
  );
  return issueTokens(sql, grant.id, code.workspace_id, false);
}

async function refreshGrant(sql: Sql, _issuer: string, form: Record<string, string | undefined>) {
  if (!form.refresh_token || !form.client_id) throw new OAuthError("invalid_request", "Send refresh_token and client_id.");
  const hash = await sha256Hex(form.refresh_token);
  const invalid = new OAuthError("invalid_grant", "This connection has ended. Connect Post Social again.");
  const [grant] = await sql<GrantRow & { refresh_expires_at: string; expired: boolean }>(
    `SELECT g.id, g.workspace_id, g.user_id, c.client_id, c.client_name, g.refresh_expires_at < now() AS expired
     FROM public.oauth_grants g JOIN public.oauth_clients c ON c.id = g.oauth_client_id
     WHERE g.refresh_token_hash = $1 AND g.revoked_at IS NULL`,
    [hash],
  );
  if (!grant) {
    // An old refresh token came back after it was replaced. Within a short grace period
    // that is an app retrying; after it, someone else has the token, so end the grant.
    const [reused] = await sql<{ id: string; within_grace: boolean }>(
      `SELECT id, refresh_rotated_at > now() - make_interval(secs => $2) AS within_grace
       FROM public.oauth_grants WHERE previous_refresh_token_hash = $1 AND revoked_at IS NULL`,
      [hash, REUSE_GRACE_SECONDS],
    );
    if (reused && !reused.within_grace) {
      await sql(
        `WITH t AS (DELETE FROM public.oauth_access_tokens WHERE oauth_grant_id = $1)
         UPDATE public.oauth_grants SET revoked_at = now(), refresh_token_hash = NULL WHERE id = $1`,
        [reused.id],
      );
    }
    throw invalid;
  }
  if (grant.expired || grant.client_id !== form.client_id) throw invalid;
  if (!(await stillMember(sql, grant.workspace_id, grant.user_id))) throw invalid;
  return issueTokens(sql, grant.id, grant.workspace_id, true, hash);
}

// RFC 7009: always answers 200, whether or not the token was known.
export async function revokeToken(sql: Sql, form: Record<string, string | undefined>) {
  const token = form.token ?? "";
  if (token.startsWith("ps_at_")) {
    await sql(`DELETE FROM public.oauth_access_tokens WHERE token_hash = $1`, [await sha256Hex(token)]);
  } else if (token.startsWith("ps_rt_")) {
    await sql(
      `WITH g AS (
         UPDATE public.oauth_grants SET revoked_at = coalesce(revoked_at, now()), refresh_token_hash = NULL
         WHERE refresh_token_hash = $1 RETURNING id
       )
       DELETE FROM public.oauth_access_tokens WHERE oauth_grant_id IN (SELECT id FROM g)`,
      [await sha256Hex(token)],
    );
  }
  return {};
}

// Turns an access token into a caller, or null when it is unknown, expired, revoked, or
// the person who approved it is no longer in the workspace. Records the use.
export async function callerForAccessToken(sql: Sql, token: string | null, entryPoint: "api" | "mcp"): Promise<AgentCaller | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const rows = await sql<{ grant_id: string; workspace_id: string; actor_id: string; client_name: string; role: string; over_limit: boolean; plan_name: string; max_api_calls_per_day: number }>(
    `WITH t0 AS (
       SELECT g.id AS grant_id, g.workspace_id, a.id AS actor_id, c.client_name, m.role
       FROM public.oauth_access_tokens t
       JOIN public.oauth_grants g ON g.id = t.oauth_grant_id AND g.revoked_at IS NULL
       JOIN public.oauth_clients c ON c.id = g.oauth_client_id
       JOIN public.actors a ON a.oauth_grant_id = g.id
       JOIN public.workspace_members m ON m.workspace_id = g.workspace_id AND m.user_id = g.user_id
       WHERE t.token_hash = $1 AND t.expires_at > now()
     ), t AS (
       SELECT a.*, ${API_LIMIT_SQL} FROM t0 a ${PLAN_JOIN_SQL}
     ), used AS (
       UPDATE public.oauth_grants SET last_used_at = now() WHERE id IN (SELECT grant_id FROM t)
     ), usage AS (
       INSERT INTO public.usage_events (workspace_id, actor_id, event_type, quantity)
       SELECT workspace_id, actor_id, 'api_call', 1 FROM t WHERE NOT over_limit
     )
     SELECT * FROM t`,
    [await sha256Hex(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    kind: "grant", credentialId: row.grant_id, workspaceId: row.workspace_id, actorId: row.actor_id, mode: "live", role: row.role, displayName: row.client_name, entryPoint,
    overLimit: apiLimitMessage(row),
  };
}

// ----- the web app's list of signed-in apps -----

type GrantSummary = { id: string; label: string; client_name: string; user_id: string; last_used_at: string | null; created_at: string; revoked_at: string | null };

function person(caller: Caller) {
  if (isAgentCaller(caller) || caller.entryPoint !== "ui") throw new ApiError(403, "Connected apps are managed by a person in the Post Social web app.");
  return caller;
}

export async function listGrants(sql: Sql, caller: Caller, input: { workspace_id?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(sql, person(caller), workspaceId, false);
  const rows = await sql<GrantSummary>(
    `SELECT g.id, g.label, c.client_name, g.user_id, g.last_used_at, g.created_at, g.revoked_at
     FROM public.oauth_grants g JOIN public.oauth_clients c ON c.id = g.oauth_client_id
     WHERE g.workspace_id = $1 ORDER BY g.revoked_at IS NOT NULL, g.created_at DESC`,
    [workspaceId],
  );
  return { grants: rows };
}

// People can disconnect apps they approved; owners and admins can disconnect any.
export async function revokeGrant(sql: Sql, caller: Caller, input: { grant_id?: unknown }) {
  const grantId = requireUuid(input.grant_id, "Connection");
  const user = person(caller) as Extract<Caller, { userId: string }>;
  const [grant] = await sql<{ workspace_id: string; user_id: string; label: string; revoked_at: string | null }>(
    `SELECT workspace_id, user_id, label, revoked_at FROM public.oauth_grants WHERE id = $1`,
    [grantId],
  );
  if (!grant) throw new ApiError(404, "That connection was not found.");
  const member = await membership(sql, user, grant.workspace_id, false).catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That connection was not found.");
    throw error;
  });
  if (grant.user_id !== user.userId && member.role !== "owner" && member.role !== "admin") {
    throw new ApiError(403, "Only owners and admins can disconnect apps someone else approved.");
  }
  await sql(
    `WITH t AS (DELETE FROM public.oauth_access_tokens WHERE oauth_grant_id = $1),
     audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary)
       SELECT $2, $3, 'ui', 'oauth_grant.revoked', 'oauth_grant', $1, $4 WHERE $5
     )
     UPDATE public.oauth_grants SET revoked_at = coalesce(revoked_at, now()), refresh_token_hash = NULL WHERE id = $1`,
    [grantId, grant.workspace_id, member.actor_id, `Disconnected ${grant.label}`, grant.revoked_at === null],
  );
  return { grant_id: grantId, revoked: true };
}

export const grantActions = { list_grants: listGrants, revoke_grant: revokeGrant } as const;
