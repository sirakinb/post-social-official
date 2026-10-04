// Server-side access to InsForge with the admin key: parameterized SQL and checking who a
// sign-in token belongs to. Runtime-neutral (functions, worker, tests).
import type { Sql } from "./media/service";

export function createSql(baseUrl: string, adminKey: string, fetchImpl: typeof fetch = fetch): Sql {
  return async <T>(query: string, params: unknown[]) => {
    const response = await fetchImpl(`${baseUrl}/api/database/advance/rawsql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, params }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Database error (${response.status}): ${text.slice(0, 500)}`);
    return (JSON.parse(text) as { rows: T[] }).rows;
  };
}

export type SignedInUser = { id: string; email: string; name: string };

// Returns the signed-in person for a user access token, or null if it is missing or invalid.
export async function userForToken(baseUrl: string, token: string | null, fetchImpl: typeof fetch = fetch): Promise<SignedInUser | null> {
  if (!token) return null;
  const response = await fetchImpl(`${baseUrl}/api/auth/sessions/current`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    user?: { id?: string; email?: string; profile?: { name?: string } | null; name?: string };
  } | null;
  const user = body?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, email: user.email, name: user.profile?.name || user.name || user.email };
}
