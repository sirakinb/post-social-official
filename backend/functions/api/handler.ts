// HTTP layer for the `api` InsForge function:
//   /v1/...            REST API, authenticated with an API key (Authorization: Bearer ps_...)
//   /v1/openapi.json   the API description (public)
//   /mcp               MCP server (streamable HTTP), same keys
//   /keys              API key management for the web app, with the person's sign-in token
import { ApiError, type Caller } from "../../lib/access";
import { callerForKey, keyActions } from "../../lib/api/keys";
import { handleMcp } from "../../lib/api/mcp";
import { openApiDocument } from "../../lib/api/openapi";
import { bodyInput, describeError, errorBody, handleRest } from "../../lib/api/rest";
import type { ApiDeps } from "../../lib/api/operations";
import type { SignedInUser } from "../../lib/insforge-admin";
import { originAllowed } from "../media/handler";

export type ApiHandlerDeps = ApiDeps & {
  callerForKey: typeof callerForKey;
  userForToken: (token: string | null) => Promise<SignedInUser | null>;
  allowedOrigins: string[];
  publicApiUrl: string; // where developers reach the API, e.g. https://www.postsocial.xyz/api
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const bearer = (request: Request) => request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

const unauthorized = (message: string) =>
  json(401, errorBody(401, message), { "WWW-Authenticate": 'Bearer realm="Post Social"' });

export function createApiHandler(deps: ApiHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    // The function may be reached directly (/v1/...) or through the web domain (/api/v1/...).
    const path = new URL(request.url).pathname.replace(/\/+$/, "").replace(/^\/api(?=\/)/, "") || "/";

    if (path === "/keys") return keysRoute(deps, request);

    if (path === "/v1/openapi.json" && request.method === "GET") {
      return json(200, openApiDocument(`${deps.publicApiUrl}`), { "Access-Control-Allow-Origin": "*" });
    }

    if (path === "/mcp") {
      if (request.method !== "POST") return json(405, errorBody(405, "This MCP server answers POST requests only (no event stream)."), { Allow: "POST" });
      const caller = await deps.callerForKey(deps.sql, bearer(request), "mcp");
      if (!caller) return unauthorized("Connect with a Post Social API key: Authorization: Bearer ps_live_...");
      let message: unknown;
      try {
        message = await bodyInputAllowingArrays(request);
      } catch {
        return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body is not valid JSON." } });
      }
      const reply = await handleMcp(deps, caller, message);
      return reply === null ? new Response(null, { status: 202 }) : json(200, reply);
    }

    if (path === "/v1" || path.startsWith("/v1/")) {
      const caller = await deps.callerForKey(deps.sql, bearer(request), "api");
      if (!caller) return unauthorized("Send a valid API key: Authorization: Bearer ps_live_... Create one in Post Social under API keys.");
      const result = await handleRest(deps, caller, request, path);
      return json(result.status, result.body, result.headers);
    }

    return json(404, errorBody(404, "Not found. The API lives under /v1 and the MCP server at /mcp."));
  };
}

async function bodyInputAllowingArrays(request: Request) {
  const text = await request.text();
  if (text.length > 256 * 1024) throw new Error("too large");
  return JSON.parse(text) as unknown;
}

// Web app only: create, list and revoke keys with the person's sign-in token.
async function keysRoute(deps: ApiHandlerDeps, request: Request) {
  const origin = request.headers.get("origin");
  const cors: Record<string, string> = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" };
  if (origin && originAllowed(origin, deps.allowedOrigins)) cors["Access-Control-Allow-Origin"] = origin;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json(405, errorBody(405, "Use POST."), cors);
  const user = await deps.userForToken(bearer(request));
  if (!user) return json(401, errorBody(401, "Sign in to manage API keys."), cors);
  try {
    const body = await bodyInput(request);
    const name = String(body.action);
    if (!Object.hasOwn(keyActions, name)) throw new ApiError(400, `Unknown action. Use one of: ${Object.keys(keyActions).join(", ")}.`);
    const caller: Caller = { userId: user.id, displayName: user.name, entryPoint: "ui" };
    return json(200, await keyActions[name as keyof typeof keyActions](deps.sql, caller, body), cors);
  } catch (error) {
    const { status, message } = describeError(error);
    return json(status, errorBody(status, message), cors);
  }
}
