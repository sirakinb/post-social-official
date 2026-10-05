// HTTP layer for the `api` InsForge function:
//   /v1/...            REST API (Authorization: Bearer <API key or OAuth access token>)
//   /v1/openapi.json   the API description (public)
//   /mcp               MCP server (streamable HTTP), same credentials
//   /.well-known/...   OAuth discovery for AI apps (public)
//   /oauth/register, /oauth/token, /oauth/revoke   OAuth endpoints for AI apps
//   /oauth/consent     the consent page's decision, with the person's sign-in token
//   /keys              API keys and connected apps for the web app, with the person's sign-in token
//   /waitlist          the landing page's waitlist (public, POST {email})
//   /internal/limits   sign-in and password-reset limits, for our website only (shared secret)
import { ApiError, type AgentCaller, type Caller, type Sql } from "../../lib/access";
import { callerForKey, keyActions } from "../../lib/api/keys";
import { handleMcp } from "../../lib/api/mcp";
import { openApiDocument } from "../../lib/api/openapi";
import { bodyInput, describeError, errorBody, handleRest } from "../../lib/api/rest";
import { availableOperations, type ApiDeps } from "../../lib/api/operations";
import type { SignedInUser } from "../../lib/insforge-admin";
import {
  authorizationServerMetadata,
  callerForAccessToken,
  checkAuthorization,
  decideAuthorization,
  endpoints,
  exchangeToken,
  grantActions,
  OAuthError,
  protectedResourceMetadata,
  registerClient,
  revokeToken,
  type AuthorizeParams,
} from "../../lib/oauth/server";
import { usageReport } from "../../lib/usage";
import { mediaLinks } from "../../lib/media/links";
import { tiktokCreatorInfo } from "../../lib/connections/tiktok-creator";
import type { Settings } from "../../lib/connections/platforms";
import { listAnalytics, postAnalytics, refreshAnalytics } from "../../lib/analytics";
import { originAllowed } from "../media/handler";
import { joinWaitlist } from "../../lib/waitlist";
import { reportError } from "../../lib/telemetry";
import { clientIp, enforceLimit, fromOurWebsite, hashId, retryHeaders, takeLimit } from "../../lib/rate-limit";

export type ApiHandlerDeps = ApiDeps & {
  callerForKey: typeof callerForKey;
  callerForAccessToken: typeof callerForAccessToken;
  userForToken: (token: string | null) => Promise<SignedInUser | null>;
  allowedOrigins: string[];
  publicApiUrl: string; // where developers reach the API, e.g. https://www.postsocial.xyz/api
  setting?: Settings; // secrets, for reading a connected account's live settings (TikTok)
  // Shared with our website, which forwards visitors' addresses (rate limits per address).
  proxySecret?: string | null;
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const bearer = (request: Request) => request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

// OAuth discovery and token endpoints are called from AI apps, some running in a browser.
const OPEN_CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version" };

const allActions = { ...keyActions, ...grantActions, usage: usageReport };

async function agentFor(deps: ApiHandlerDeps, request: Request, entryPoint: "api" | "mcp"): Promise<AgentCaller | null> {
  const token = bearer(request);
  if (token?.startsWith("ps_at_")) return deps.callerForAccessToken(deps.sql, token, entryPoint);
  return deps.callerForKey(deps.sql, token, entryPoint);
}

export function createApiHandler(deps: ApiHandlerDeps) {
  const issuer = deps.webAppUrl;
  // The 401 tells an AI app where to find out how to sign in (MCP authorization spec).
  const unauthorized = (message: string) =>
    json(401, errorBody(401, message), { ...OPEN_CORS, "WWW-Authenticate": `Bearer realm="Post Social", resource_metadata="${endpoints(issuer).resourceMetadata}"` });

  return async function handle(request: Request): Promise<Response> {
    // The function may be reached directly (/v1/...) or through the web domain (/api/v1/...).
    const path = new URL(request.url).pathname.replace(/\/+$/, "").replace(/^\/api(?=\/)/, "") || "/";

    if (path === "/keys") return personRoute(deps, request);
    if (path === "/oauth/consent") return consentRoute(deps, request);
    if (path === "/waitlist") return waitlistRoute(deps, request);
    if (path === "/internal/limits") return internalLimitsRoute(deps, request);

    if (request.method === "OPTIONS" && (path.startsWith("/.well-known/") || path.startsWith("/oauth/") || path === "/mcp")) {
      return new Response(null, { status: 204, headers: OPEN_CORS });
    }
    if (path.startsWith("/.well-known/oauth-protected-resource")) return json(200, protectedResourceMetadata(issuer), OPEN_CORS);
    if (path.startsWith("/.well-known/oauth-authorization-server")) return json(200, authorizationServerMetadata(issuer), OPEN_CORS);
    if (path === "/oauth/register" || path === "/oauth/token" || path === "/oauth/revoke") return oauthRoute(deps, request, path, issuer);

    if (path === "/v1/openapi.json" && request.method === "GET") {
      return json(200, openApiDocument(`${deps.publicApiUrl}`, availableOperations(deps)), { "Access-Control-Allow-Origin": "*" });
    }

    if (path === "/mcp") {
      if (request.method !== "POST") return json(405, errorBody(405, "This MCP server answers POST requests only (no event stream)."), { Allow: "POST" });
      const caller = await agentFor(deps, request, "mcp");
      if (!caller) return unauthorized("Sign in to Post Social, or send an API key: Authorization: Bearer ps_live_...");
      if (caller.overLimit) return json(429, errorBody(429, caller.overLimit), { ...OPEN_CORS, "Retry-After": secondsToMidnightUtc() });
      const wait = await takeLimit(deps.sql, "api_credential", caller.credentialId);
      if (wait) return json(429, errorBody(429, tooFast(wait)), { ...OPEN_CORS, "Retry-After": String(wait) });
      let message: unknown;
      try {
        message = await bodyInputAllowingArrays(request);
      } catch {
        return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body is not valid JSON." } });
      }
      const reply = await handleMcp(deps, caller, message);
      return reply === null ? new Response(null, { status: 202, headers: OPEN_CORS }) : json(200, reply, OPEN_CORS);
    }

    if (path === "/v1" || path.startsWith("/v1/")) {
      const caller = await agentFor(deps, request, "api");
      if (!caller) return unauthorized("Send a valid API key: Authorization: Bearer ps_live_... Create one in Post Social under API keys.");
      if (caller.overLimit) return json(429, errorBody(429, caller.overLimit), { "Retry-After": secondsToMidnightUtc() });
      const wait = await takeLimit(deps.sql, "api_credential", caller.credentialId);
      if (wait) return json(429, errorBody(429, tooFast(wait)), { "Retry-After": String(wait) });
      const result = await handleRest(deps, caller, request, path);
      return json(result.status, result.body, result.headers);
    }

    return json(404, errorBody(404, "Not found. The API lives under /v1 and the MCP server at /mcp."));
  };
}

async function waitlistRoute(deps: ApiHandlerDeps, request: Request) {
  if (request.method !== "POST") return json(405, errorBody(405, "Send a POST with {\"email\": ...}."), { Allow: "POST" });
  try {
    await enforceLimit(deps.sql, "waitlist_ip", await hashId(clientIp(request, deps.proxySecret)), "Too many sign-ups from this network. Try again later.");
    const text = await request.text();
    if (text.length > 2048) throw new ApiError(413, "The request is too large.");
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new ApiError(400, "The body is not valid JSON.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "Send a JSON object with an email.");
    return json(200, await joinWaitlist(deps.sql, input as Record<string, unknown>));
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, errorBody(error.status, error.message), retryHeaders(error));
    reportError(error, { area: "waitlist" });
    return json(500, errorBody(500, "Joining the waitlist failed. Try again."));
  }
}

const tooFast = (wait: number) => `Too many requests from this key or app. Wait ${wait} seconds, then try again.`;

// Sign-in and password-reset limits, checked by our website before it talks to the sign-in
// service. Only callers holding the shared proxy secret may use it.
async function internalLimitsRoute(deps: ApiHandlerDeps, request: Request) {
  if (request.method !== "POST" || !fromOurWebsite(request, deps.proxySecret)) return json(404, errorBody(404, "Not found."));
  try {
    const body = await bodyInput(request);
    const ip = await hashId(clientIp(request, deps.proxySecret));
    const email = typeof body.email === "string" && body.email.trim() ? await hashId(body.email) : null;
    if (body.check === "signin") {
      await enforceLimit(deps.sql, "signin_ip", ip);
      if (email) await enforceLimit(deps.sql, "signin_email", email);
    } else if (body.check === "reset_request") {
      await enforceLimit(deps.sql, "reset_request_ip", ip);
      if (email) await enforceLimit(deps.sql, "reset_request_email", email);
    } else if (body.check === "reset_complete") {
      if (email) await enforceLimit(deps.sql, "reset_complete_email", email);
    } else {
      throw new ApiError(400, "Unknown check.");
    }
    return json(200, { ok: true });
  } catch (error) {
    const { status, message } = describeError(error);
    return json(status, errorBody(status, message), retryHeaders(error));
  }
}

function secondsToMidnightUtc(now = Date.now()) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return String(Math.ceil((next.getTime() - now) / 1000));
}

async function bodyInputAllowingArrays(request: Request) {
  const text = await request.text();
  if (text.length > 256 * 1024) throw new Error("too large");
  return JSON.parse(text) as unknown;
}

// Token and revocation requests are form-encoded (some apps send JSON; both are accepted).
async function formInput(request: Request): Promise<Record<string, string | undefined>> {
  const text = await request.text();
  if (text.length > 16 * 1024) throw new OAuthError("invalid_request", "The request is too large.");
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
    } catch {
      throw new OAuthError("invalid_request", "The body is not valid JSON.");
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

async function oauthRoute(deps: ApiHandlerDeps, request: Request, path: string, issuer: string) {
  if (request.method !== "POST") return json(405, { error: "invalid_request", error_description: "Use POST." }, { ...OPEN_CORS, Allow: "POST" });
  try {
    const ipId = await hashId(clientIp(request, deps.proxySecret));
    await enforceLimit(deps.sql, path === "/oauth/register" ? "oauth_register_ip" : "oauth_token_ip", ipId);
    if (path === "/oauth/register") {
      const body = (await bodyInput(request).catch(() => {
        throw new OAuthError("invalid_client_metadata", "Send the registration as a JSON object.");
      })) as Record<string, unknown>;
      return json(201, await registerClient(deps.sql, body), OPEN_CORS);
    }
    const form = await formInput(request);
    if (path === "/oauth/token") return json(200, await exchangeToken(deps.sql, issuer, form), { ...OPEN_CORS, Pragma: "no-cache" });
    return json(200, await revokeToken(deps.sql, form), OPEN_CORS);
  } catch (error) {
    if (error instanceof OAuthError) return json(error.status, { error: error.error, error_description: error.description }, OPEN_CORS);
    if (error instanceof ApiError && error.status === 429) return json(429, { error: "temporarily_unavailable", error_description: error.message }, { ...OPEN_CORS, ...retryHeaders(error) });
    const { status } = describeError(error);
    return json(status >= 500 ? 500 : 400, { error: status >= 500 ? "server_error" : "invalid_request", error_description: "The request could not be completed." }, OPEN_CORS);
  }
}

// The consent page (a server action in the web app) checks a sign-in request and records
// the person's decision. Only the web app's server calls this, with the person's token.
async function consentRoute(deps: ApiHandlerDeps, request: Request) {
  if (request.method !== "POST") return json(405, errorBody(405, "Use POST."));
  const user = await deps.userForToken(bearer(request));
  if (!user) return json(401, errorBody(401, "Sign in to approve an app."));
  try {
    await enforceLimit(deps.sql, "consent_user", user.id);
    const body = await bodyInput(request);
    const params = (body.params ?? {}) as AuthorizeParams;
    if (body.action === "check") {
      const { client, redirect } = await checkAuthorization(deps.sql, deps.webAppUrl, params);
      if (redirect) return json(200, { redirect });
      let redirectHost = "";
      try {
        const target = new URL(params.redirect_uri!);
        redirectHost = target.protocol === "https:" || target.protocol === "http:" ? target.host : `${target.protocol}//`;
      } catch {
        // already validated
      }
      return json(200, { client_name: client.client_name, client_uri: client.client_uri, redirect_host: redirectHost });
    }
    if (body.action === "decide") {
      return json(200, await decideAuthorization(deps.sql, deps.webAppUrl, { id: user.id, name: user.name }, { ...params, workspace_id: body.workspace_id, approve: body.approve }));
    }
    throw new ApiError(400, "Unknown action. Use check or decide.");
  } catch (error) {
    if (error instanceof OAuthError) return json(400, { error: { code: error.error, message: error.description } });
    const { status, message } = describeError(error);
    return json(status, errorBody(status, message), retryHeaders(error));
  }
}

// Web app only: API keys and connected apps, with the person's sign-in token.
async function personRoute(deps: ApiHandlerDeps, request: Request) {
  const origin = request.headers.get("origin");
  const cors: Record<string, string> = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" };
  if (origin && originAllowed(origin, deps.allowedOrigins)) cors["Access-Control-Allow-Origin"] = origin;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json(405, errorBody(405, "Use POST."), cors);
  const user = await deps.userForToken(bearer(request));
  if (!user) return json(401, errorBody(401, "Sign in to manage API keys and connected apps."), cors);
  try {
    await enforceLimit(deps.sql, "person_user", user.id);
    const body = await bodyInput(request);
    const name = String(body.action);
    // Stats actions exist only where stats are switched on.
    const statsActions = deps.analyticsPlatforms.length
      ? {
          analytics: (sql: Sql, caller: Caller, input: Record<string, unknown>) => listAnalytics(sql, caller, deps.analyticsPlatforms, input as { workspace_id: string }),
          post_analytics: (sql: Sql, caller: Caller, input: Record<string, unknown>) => postAnalytics(sql, caller, deps.analyticsPlatforms, input),
          refresh_analytics: (sql: Sql, caller: Caller, input: Record<string, unknown>) => refreshAnalytics(sql, caller, deps.analyticsPlatforms, input as { workspace_id: string }),
        }
      : {};
    const mediaActions = {
      media_links: (sql: Sql, caller: Caller, input: Record<string, unknown>) => mediaLinks(sql, deps.r2, caller, input),
      tiktok_creator_info: (sql: Sql, caller: Caller, input: Record<string, unknown>) => {
        if (!deps.setting) throw new ApiError(503, "TikTok settings can't be read here.");
        return tiktokCreatorInfo({ sql, setting: deps.setting }, caller, input);
      },
    };
    const actions = { ...allActions, ...statsActions, ...mediaActions } as Record<string, (sql: Sql, caller: Caller, input: Record<string, unknown>) => Promise<unknown>>;
    if (!Object.hasOwn(actions, name)) throw new ApiError(400, `Unknown action. Use one of: ${Object.keys(actions).join(", ")}.`);
    const caller: Caller = { userId: user.id, displayName: user.name, entryPoint: "ui" };
    return json(200, await actions[name](deps.sql, caller, body), cors);
  } catch (error) {
    const { status, message } = describeError(error);
    return json(status, errorBody(status, message), { ...cors, ...retryHeaders(error) });
  }
}
