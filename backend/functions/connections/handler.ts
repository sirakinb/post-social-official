// HTTP layer for the `connections` InsForge function, served on the function host so each
// path is stable for platform dashboards:
//   POST /start                         { workspace_id, platform, return_to } -> { url }
//   POST /disconnect                    { account_id }
//   GET  /oauth/{platform}/callback     platform sign-in callback: sends the browser to the web
//                                       app's /beta/connect/finish, which finishes it as the
//                                       signed-in person (POST /complete)
//   POST /complete                      { platform, params } -> where to go next
//   POST /meta/data-deletion            Meta data-deletion callback
//   GET  /meta/data-deletion/status     ?code=
//   POST /meta/deauthorize              Meta deauthorize callback
import { ApiError } from "../../lib/access";
import type { SignedInUser } from "../../lib/insforge-admin";
import { completeConnection, disconnectAccount, finishingOrigin, isPlatform, startConnection, type ConnectionDeps } from "../../lib/connections/service";
import { deletionStatus, handleDataDeletion, handleDeauthorize } from "../../lib/connections/meta-deletion";

export type ConnectionsHandlerDeps = ConnectionDeps & {
  userForToken: (token: string | null) => Promise<SignedInUser | null>;
  webAppHome: string; // where to send people when there is no saved return address
  metaAppSecrets: string[];
  selfBaseUrl: string; // public base URL of this function, for the deletion status link
};

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function cors(request: Request, deps: ConnectionsHandlerDeps): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" };
  if (origin && deps.allowedReturnOrigins.some((o) => o === origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function redirectTo(base: string, params: Record<string, string>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Cache-Control": "no-store" } });
}

export function createConnectionsHandler(deps: ConnectionsHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const method = request.method;

    try {
      const callback = path.match(/^\/oauth\/([a-z]+)\/callback$/);
      if (callback && method === "GET") {
        if (!isPlatform(callback[1])) return json(404, { error: "Unknown platform." });
        // Nothing is finished here: anyone holding the sign-in link can reach this page.
        // The web app finishes it as the signed-in person who started it.
        const query = new URL(request.url).searchParams;
        const origin = await finishingOrigin(deps, callback[1], query.get("state"));
        if (!origin) return redirectTo(deps.webAppHome, { error: "This connection request expired or was already used. Start again." });
        const finish = new URL("/beta/connect/finish", origin);
        finish.searchParams.set("platform", callback[1]);
        query.forEach((value, key) => finish.searchParams.set(key, value));
        return new Response(null, { status: 302, headers: { Location: finish.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
      }

      if (path === "/meta/data-deletion" && method === "POST") {
        return json(200, await handleDataDeletion({ sql: deps.sql, appSecrets: deps.metaAppSecrets }, request, `${deps.selfBaseUrl}/meta/data-deletion/status`));
      }
      if (path === "/meta/data-deletion/status" && method === "GET") {
        const status = await deletionStatus(deps.sql, new URL(request.url).searchParams.get("code"));
        return status ? json(200, status) : json(404, { error: "Deletion request not found." });
      }
      if (path === "/meta/deauthorize" && method === "POST") {
        return json(200, await handleDeauthorize({ sql: deps.sql, appSecrets: deps.metaAppSecrets }, request));
      }

      if (path === "/start" || path === "/disconnect" || path === "/complete") {
        const headers = cors(request, deps);
        if (method === "OPTIONS") return new Response(null, { status: 204, headers });
        if (method !== "POST") return json(405, { error: "Use POST." }, headers);
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
        const user = await deps.userForToken(token);
        if (!user) return json(401, { error: "Sign in to manage connected accounts." }, headers);
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body) return json(400, { error: "Send a JSON body." }, headers);
        const caller = { userId: user.id, displayName: user.name, entryPoint: "ui" as const };
        if (path === "/complete") {
          if (!isPlatform(body.platform)) return json(400, { error: "Unknown platform." }, headers);
          const params = new URLSearchParams(Object.entries((body.params ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string") as Array<[string, string]>);
          return json(200, await completeConnection(deps, body.platform, params, user.id), headers);
        }
        const result = path === "/start" ? await startConnection(deps, caller, body) : await disconnectAccount(deps, caller, body);
        return json(200, result, headers);
      }

      return json(404, { error: "Not found." });
    } catch (error) {
      if (error instanceof ApiError) return json(error.status, { error: error.message });
      if (path.startsWith("/meta/")) return json(400, { error: "The signed request could not be verified." });
      console.error("connections function error", error);
      return json(500, { error: "Something went wrong on our side. Try again in a moment." });
    }
  };
}
