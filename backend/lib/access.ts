// Shared request checks for Post Social server code: errors with an HTTP status and a
// plain-language message, and workspace membership with the caller's actor.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Sql = <T = Record<string, unknown>>(query: string, params: unknown[]) => Promise<T[]>;

// A signed-in person (web app), or an API key acting for one workspace (REST API or MCP).
export type UserCaller = { kind?: "user"; userId: string; displayName: string; entryPoint: "ui" | "api" | "mcp" };
// An AI acting for one workspace: an API key, or an app the person signed in to with
// OAuth (a grant). Signed-in apps carry the role of the person who approved them, so an
// app approved by a reviewer can only read.
export type AgentCaller = {
  kind: "key" | "grant";
  credentialId: string; // the api_keys or oauth_grants row
  workspaceId: string;
  actorId: string;
  mode: "test" | "live";
  role?: string;
  displayName: string;
  entryPoint: "api" | "mcp";
};
export type Caller = UserCaller | AgentCaller;

export const isAgentCaller = (caller: Caller): caller is AgentCaller => caller.kind === "key" || caller.kind === "grant";

export type Membership = { role: string; actor_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(400, `${label} is missing or not valid.`);
  return value;
}

// Finds the caller's role and their actor in the workspace, creating the actor on first use.
export async function membership(sql: Sql, caller: Caller, workspaceId: string, write: boolean, writeRefusal = "Reviewers can view but not change anything."): Promise<Membership> {
  // A key or signed-in app belongs to exactly one workspace and acts as its own actor.
  if (isAgentCaller(caller)) {
    if (caller.workspaceId !== workspaceId) throw new ApiError(404, "That workspace was not found.");
    if (write && caller.role === "reviewer") throw new ApiError(403, `${writeRefusal} This app was approved by a reviewer, so it can only read.`);
    // Never the person's own role: an app or key must not pass an owner/admin check.
    return { role: caller.kind, actor_id: caller.actorId };
  }
  const rows = await sql<Membership>(
    `WITH member AS (
       SELECT m.workspace_id, m.user_id, m.role
       FROM public.workspace_members m
       WHERE m.workspace_id = $1 AND m.user_id = $2
     ), inserted AS (
       INSERT INTO public.actors (workspace_id, kind, user_id, display_name)
       SELECT workspace_id, 'user', user_id, $3 FROM member
       ON CONFLICT (workspace_id, user_id) WHERE kind = 'user' DO NOTHING
       RETURNING id
     )
     SELECT member.role,
            coalesce((SELECT id FROM inserted),
                     (SELECT a.id FROM public.actors a
                      WHERE a.workspace_id = $1 AND a.user_id = $2 AND a.kind = 'user')) AS actor_id
     FROM member`,
    [workspaceId, caller.userId, caller.displayName],
  );
  const found = rows[0];
  // Same answer for "no such workspace" and "not a member", so ids cannot be probed.
  if (!found) throw new ApiError(404, "That workspace was not found.");
  if (write && found.role === "reviewer") throw new ApiError(403, writeRefusal);
  return found;
}
