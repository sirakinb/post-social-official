// HTTP layer for the `media` InsForge function: POST { action, ...input } with the person's
// access token as a Bearer token. Runtime-neutral so it can be tested in Node.
import { reportError } from "../../lib/telemetry";
import { MediaError, mediaActions, type MediaDeps } from "../../lib/media/service";
import type { SignedInUser } from "../../lib/insforge-admin";

export type HandlerDeps = MediaDeps & {
  userForToken: (token: string | null) => Promise<SignedInUser | null>;
  allowedOrigins: string[];
};

function corsHeaders(request: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  if (origin && originAllowed(origin, allowedOrigins)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// Entries may contain one "*" wildcard, e.g. https://post-social-*-app-build-26.vercel.app
export function originAllowed(origin: string, allowed: string[]) {
  return allowed.some((pattern) => {
    if (!pattern.includes("*")) return pattern === origin;
    const [prefix, suffix] = pattern.split("*");
    const middle = origin.slice(prefix.length, origin.length - suffix.length);
    return origin.startsWith(prefix) && origin.endsWith(suffix) && origin.length >= prefix.length + suffix.length && /^[a-z0-9-]*$/i.test(middle);
  });
}

function json(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

export function createMediaHandler(deps: HandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, deps.allowedOrigins);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json(405, { error: "Use POST." }, cors);

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const user = await deps.userForToken(token);
    if (!user) return json(401, { error: "Sign in to manage media." }, cors);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json(400, { error: "Send a JSON body with an action." }, cors);
    }
    const actionName = String(body?.action);
    // Own keys only, so inherited names like "constructor" are not treated as actions.
    if (!Object.hasOwn(mediaActions, actionName)) {
      return json(400, { error: `Unknown action. Use one of: ${Object.keys(mediaActions).join(", ")}.` }, cors);
    }
    const action = mediaActions[actionName as keyof typeof mediaActions];

    try {
      const caller = { userId: user.id, displayName: user.name, entryPoint: "ui" as const };
      const result = await (action as (d: MediaDeps, c: typeof caller, i: Record<string, unknown>) => Promise<unknown>)(deps, caller, body);
      return json(200, result, cors);
    } catch (error) {
      if (error instanceof MediaError) return json(error.status, { error: error.message }, cors);
      reportError(error, { area: "media function", action: typeof body?.action === "string" ? body.action : null });
      return json(500, { error: "Something went wrong on our side. Try again in a moment." }, cors);
    }
  };
}
