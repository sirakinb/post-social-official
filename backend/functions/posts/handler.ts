// HTTP layer for the `posts` InsForge function: POST { action, ...input } with the
// person's access token. Phase 5 adds REST routes and MCP tools over the same actions.
import { ApiError, type Caller } from "../../lib/access";
import type { SignedInUser } from "../../lib/insforge-admin";
import { postActions, type PostsDeps } from "../../lib/publishing/service";
import { originAllowed } from "../media/handler";

export type PostsHandlerDeps = PostsDeps & {
  userForToken: (token: string | null) => Promise<SignedInUser | null>;
  allowedOrigins: string[];
};

function json(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export function createPostsHandler(deps: PostsHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const cors: Record<string, string> = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" };
    if (origin && originAllowed(origin, deps.allowedOrigins)) cors["Access-Control-Allow-Origin"] = origin;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json(405, { error: "Use POST." }, cors);

    const user = await deps.userForToken(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
    if (!user) return json(401, { error: "Sign in to manage posts." }, cors);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json(400, { error: "Send a JSON body with an action." }, cors);
    const name = String(body.action);
    if (!Object.hasOwn(postActions, name)) return json(400, { error: `Unknown action. Use one of: ${Object.keys(postActions).join(", ")}.` }, cors);

    try {
      const caller: Caller = { userId: user.id, displayName: user.name, entryPoint: "ui" };
      return json(200, await postActions[name as keyof typeof postActions](deps, caller, body), cors);
    } catch (error) {
      if (error instanceof ApiError) return json(error.status, { error: error.message }, cors);
      const message = error instanceof Error ? error.message : String(error);
      // Rules enforced by the database come back as plain sentences.
      const rule = message.match(/Invalid post transition: \w+ -> \w+|Only approved posts can be queued[^"]*/)?.[0];
      if (rule) return json(409, { error: rule }, cors);
      console.error("posts function error", error);
      return json(500, { error: "Something went wrong on our side. Try again in a moment." }, cors);
    }
  };
}
