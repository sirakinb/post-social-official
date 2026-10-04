// API keys: named keys a person creates for their AIs and tools. A key belongs to one
// workspace and acts as its own actor ("via Claude Code"). Only the SHA-256 of a key is
// stored; the full key is shown once. Test keys can do everything except publish.
import { ApiError, isKeyCaller, membership, requireUuid, type Caller, type KeyCaller, type Sql } from "../access";
import { randomToken, sha256Hex } from "../connections/crypto";

const MAX_KEYS = 50;
const KEY_SHAPE = /^ps_(live|test)_[A-Za-z0-9_-]{43}$/;

export function newKey(mode: "live" | "test") {
  const key = `ps_${mode}_${randomToken(32)}`;
  return { key, prefix: key.slice(0, 16) };
}

type KeyRow = { id: string; name: string; key_prefix: string; mode: "live" | "test"; last_used_at: string | null; revoked_at: string | null; created_at: string };

const publicKey = (row: KeyRow) => ({
  id: row.id,
  name: row.name,
  prefix: row.key_prefix,
  mode: row.mode,
  last_used_at: row.last_used_at,
  revoked_at: row.revoked_at,
  created_at: row.created_at,
});

// Key management is for people in the web app: an AI cannot mint or revoke keys.
function person(caller: Caller) {
  if (isKeyCaller(caller) || caller.entryPoint !== "ui") throw new ApiError(403, "API keys are managed by a person in the Post Social web app.");
  return caller;
}

async function manager(sql: Sql, caller: Caller, workspaceId: string) {
  const member = await membership(sql, person(caller), workspaceId, true, "Reviewers cannot manage API keys.");
  if (member.role !== "owner" && member.role !== "admin") throw new ApiError(403, "Only owners and admins can manage API keys.");
  return member;
}

export async function createKey(sql: Sql, caller: Caller, input: { workspace_id?: unknown; name?: unknown; mode?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) throw new ApiError(400, "Give the key a name of 1 to 80 characters, e.g. \"Claude Code\".");
  if (input.mode !== "live" && input.mode !== "test") throw new ApiError(400, "Choose a mode: live or test.");
  const member = await manager(sql, caller, workspaceId);
  const user = caller as Extract<Caller, { userId: string }>;
  const { key, prefix } = newKey(input.mode);

  const rows = await sql<KeyRow & { too_many: boolean }>(
    `WITH counted AS (
       SELECT count(*) >= $7 AS too_many FROM public.api_keys WHERE workspace_id = $1 AND revoked_at IS NULL
     ), k AS (
       INSERT INTO public.api_keys (workspace_id, created_by, name, key_prefix, key_hash, mode)
       SELECT $1, $2, $3, $4, $5, $6 FROM counted WHERE NOT too_many
       RETURNING *
     ), a AS (
       INSERT INTO public.actors (workspace_id, kind, api_key_id, display_name)
       SELECT workspace_id, 'api_key', id, name FROM k
     ), audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       SELECT workspace_id, $8, 'ui', 'api_key.created', 'api_key', id, 'Created ' || mode || ' API key "' || name || '"', jsonb_build_object('prefix', key_prefix) FROM k
     )
     SELECT k.*, counted.too_many FROM counted LEFT JOIN k ON true`,
    [workspaceId, user.userId, name, prefix, await sha256Hex(key), input.mode, MAX_KEYS, member.actor_id],
  );
  if (rows[0]?.too_many) throw new ApiError(409, `A workspace can have at most ${MAX_KEYS} active keys. Revoke one you no longer use.`);
  return { ...publicKey(rows[0]), key, note: "Copy this key now. It will not be shown again." };
}

export async function listKeys(sql: Sql, caller: Caller, input: { workspace_id?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await manager(sql, caller, workspaceId);
  const rows = await sql<KeyRow>(
    `SELECT id, name, key_prefix, mode, last_used_at, revoked_at, created_at FROM public.api_keys
     WHERE workspace_id = $1 ORDER BY revoked_at IS NOT NULL, created_at DESC`,
    [workspaceId],
  );
  return { keys: rows.map(publicKey) };
}

export async function revokeKey(sql: Sql, caller: Caller, input: { key_id?: unknown }) {
  const keyId = requireUuid(input.key_id, "Key");
  const [row] = await sql<KeyRow & { workspace_id: string }>(`SELECT * FROM public.api_keys WHERE id = $1`, [keyId]);
  if (!row) throw new ApiError(404, "That key was not found.");
  const member = await manager(sql, caller, row.workspace_id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That key was not found.");
    throw error;
  });
  const [updated] = await sql<KeyRow>(
    `WITH audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary)
       SELECT $2, $3, 'ui', 'api_key.revoked', 'api_key', $1, $4 WHERE $5
     )
     UPDATE public.api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 RETURNING *`,
    [keyId, row.workspace_id, member.actor_id, `Revoked API key "${row.name}"`, row.revoked_at === null],
  );
  return publicKey(updated);
}

export const keyActions = { create: createKey, list: listKeys, revoke: revokeKey } as const;

// Turns a bearer key into a caller, or null for a missing, malformed or revoked key.
// Records the use (last used time and an api_call usage event) in the same statement.
export async function callerForKey(sql: Sql, token: string | null, entryPoint: "api" | "mcp"): Promise<KeyCaller | null> {
  if (!token || !KEY_SHAPE.test(token)) return null;
  const rows = await sql<{ id: string; workspace_id: string; mode: "live" | "test"; name: string; actor_id: string }>(
    `WITH k AS (
       UPDATE public.api_keys SET last_used_at = now()
       WHERE key_hash = $1 AND revoked_at IS NULL
       RETURNING id, workspace_id, mode, name
     ), a AS (
       SELECT k.*, actors.id AS actor_id FROM k JOIN public.actors ON actors.api_key_id = k.id
     ), usage AS (
       INSERT INTO public.usage_events (workspace_id, actor_id, event_type, quantity)
       SELECT workspace_id, actor_id, 'api_call', 1 FROM a
     )
     SELECT * FROM a`,
    [await sha256Hex(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return { kind: "key", keyId: row.id, workspaceId: row.workspace_id, actorId: row.actor_id, mode: row.mode, displayName: row.name, entryPoint };
}
