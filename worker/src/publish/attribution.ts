import type { Sql } from "../../../backend/lib/access";

// Who a publish belongs to, for PostHog: the person (so their publishes join their app
// activity and the internal-user filter applies), and where the post came from (the app,
// an API key, or a connected AI app, with the app's name when it gave one).
export type Attribution = { userId?: string; source: "app" | "api" | "ai_app" | "system" | "unknown"; aiApp?: string };

const SOURCES: Record<string, Attribution["source"]> = { user: "app", api_key: "api", oauth_grant: "ai_app", system: "system" };

export async function publishAttribution(sql: Sql, destinationId: string): Promise<Attribution> {
  try {
    const [row] = await sql<{ kind: string; user_id: string | null; client_name: string | null }>(
      // An app learns its name when it connects over MCP; until then (e.g. a connection made
      // before names were recorded) a connected app falls back to the name it registered with.
      `SELECT a.kind, coalesce(a.user_id, k.created_by, g.user_id) AS user_id,
              coalesce(a.client_name, nullif(c.client_name, 'An AI app')) AS client_name
         FROM public.destinations d
         JOIN public.actors a ON a.id = d.actor_id
         LEFT JOIN public.api_keys k ON k.id = a.api_key_id
         LEFT JOIN public.oauth_grants g ON g.id = a.oauth_grant_id
         LEFT JOIN public.oauth_clients c ON c.id = g.oauth_client_id
        WHERE d.id = $1`,
      [destinationId],
    );
    if (!row) return { source: "unknown" };
    return { userId: row.user_id ?? undefined, source: SOURCES[row.kind] ?? "unknown", aiApp: row.client_name ?? undefined };
  } catch {
    // Monitoring must never get in the way of publishing.
    return { source: "unknown" };
  }
}
