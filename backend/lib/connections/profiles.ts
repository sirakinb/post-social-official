// Profiles: named groups of connected accounts (a business, an organisation, a client).
// Creating, editing, deleting and moving accounts between profiles are open to anyone who
// can connect accounts (not reviewers); every change is audited.
import { ApiError, membership, requireUuid, type Caller, type Sql } from "../access";
import { DISPLAY_NAMES, type Platform } from "./platforms";

export type Profile = { id: string; workspace_id: string; name: string; description: string | null; color: string; timezone: string | null; created_at: string };

// The swatches offered in the web app; the API takes any #RRGGBB colour.
export const PROFILE_COLORS = ["#9B6CFF", "#3DD68C", "#F5B54A", "#F2555A", "#4AA8F5", "#F57AC4", "#2DD4BF", "#A3A3A3"];
const MAX_PROFILES = 50;
const COLUMNS = "id, workspace_id, name, description, color, timezone, created_at";

function cleanName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new ApiError(400, "Give the profile a name.");
  if (name.length > 60) throw new ApiError(400, "Keep the profile name to 60 characters.");
  return name;
}

function cleanDescription(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ApiError(400, "The description must be text.");
  const description = value.trim();
  if (description.length > 280) throw new ApiError(400, "Keep the description to 280 characters.");
  return description || null;
}

function cleanColor(value: unknown) {
  if (value === undefined || value === null || value === "") return PROFILE_COLORS[0];
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new ApiError(400, "The colour must look like #9B6CFF.");
  return value.toUpperCase();
}

export function cleanTimezone(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 64) throw new ApiError(400, "Choose a time zone like America/New_York.");
  try {
    // Throws a RangeError for names that aren't real IANA time zones.
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new ApiError(400, "Choose a time zone like America/New_York.");
  }
}

// Turns a duplicate-name error from the unique index into a plain sentence.
async function named<T>(run: () => Promise<T>, name: string) {
  try {
    return await run();
  } catch (error) {
    if (/profiles_workspace_name_idx|duplicate key/i.test(error instanceof Error ? error.message : String(error))) throw new ApiError(409, `There is already a profile called ${name}.`);
    throw error;
  }
}

async function profileFor(sql: Sql, caller: Caller, profileId: unknown, write: boolean) {
  const id = requireUuid(profileId, "Profile");
  const [profile] = await sql<Profile>(`SELECT ${COLUMNS} FROM public.profiles WHERE id = $1`, [id]);
  if (!profile) throw new ApiError(404, "That profile was not found.");
  const member = await membership(sql, caller, profile.workspace_id, write, "Reviewers cannot change profiles.").catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That profile was not found.");
    throw error;
  });
  return { profile, member };
}

export async function listProfiles(sql: Sql, caller: Caller, input: { workspace_id: string }) {
  await membership(sql, caller, input.workspace_id, false);
  const profiles = await sql<Profile & { account_count: number }>(
    `SELECT ${COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")},
            (SELECT count(*)::int FROM public.connected_accounts a WHERE a.profile_id = p.id AND a.health <> 'disconnected') AS account_count
     FROM public.profiles p WHERE p.workspace_id = $1 ORDER BY lower(p.name)`,
    [input.workspace_id],
  );
  return { profiles };
}

export async function createProfile(sql: Sql, caller: Caller, input: { workspace_id?: unknown; name?: unknown; description?: unknown; color?: unknown; timezone?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  const member = await membership(sql, caller, workspaceId, true, "Reviewers cannot change profiles.");
  const name = cleanName(input.name);
  const values = { description: cleanDescription(input.description), color: cleanColor(input.color), timezone: cleanTimezone(input.timezone) };
  const [{ count }] = await sql<{ count: number }>(`SELECT count(*)::int AS count FROM public.profiles WHERE workspace_id = $1`, [workspaceId]);
  if (Number(count) >= MAX_PROFILES) throw new ApiError(409, `A workspace can have up to ${MAX_PROFILES} profiles.`);
  const [profile] = await named(
    () =>
      sql<Profile>(
        `WITH created AS (
           INSERT INTO public.profiles (workspace_id, name, description, color, timezone, created_by_actor_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${COLUMNS}
         ), audit AS (
           INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
           SELECT $1, $6, $7, 'profile.created', 'profile', id, 'Created the profile ' || name,
                  jsonb_build_object('name', name, 'color', color, 'timezone', timezone) FROM created
         )
         SELECT * FROM created`,
        [workspaceId, name, values.description, values.color, values.timezone, member.actor_id, caller.entryPoint],
      ),
    name,
  );
  return { profile };
}

export async function updateProfile(sql: Sql, caller: Caller, input: { profile_id?: unknown; name?: unknown; description?: unknown; color?: unknown; timezone?: unknown }) {
  const { profile: before, member } = await profileFor(sql, caller, input.profile_id, true);
  const next = {
    name: input.name === undefined ? before.name : cleanName(input.name),
    description: input.description === undefined ? before.description : cleanDescription(input.description),
    color: input.color === undefined ? before.color : cleanColor(input.color),
    timezone: input.timezone === undefined ? before.timezone : cleanTimezone(input.timezone),
  };
  const [profile] = await named(
    () =>
      sql<Profile>(
        `WITH updated AS (
           UPDATE public.profiles SET name = $2, description = $3, color = $4, timezone = $5
           WHERE id = $1 RETURNING ${COLUMNS}
         ), audit AS (
           INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, before_values, after_values)
           SELECT workspace_id, $6, $7, 'profile.updated', 'profile', id, 'Updated the profile ' || name, $8::jsonb,
                  jsonb_build_object('name', name, 'description', description, 'color', color, 'timezone', timezone) FROM updated
         )
         SELECT * FROM updated`,
        [before.id, next.name, next.description, next.color, next.timezone, member.actor_id, caller.entryPoint, JSON.stringify({ name: before.name, description: before.description, color: before.color, timezone: before.timezone })],
      ),
    next.name,
  );
  return { profile };
}

// Deleting a profile keeps its accounts: they move to no profile.
export async function deleteProfile(sql: Sql, caller: Caller, input: { profile_id?: unknown }) {
  const { profile, member } = await profileFor(sql, caller, input.profile_id, true);
  const [result] = await sql<{ moved: number }>(
    `WITH moved AS (
       UPDATE public.connected_accounts SET profile_id = NULL WHERE workspace_id = $2 AND profile_id = $1 RETURNING id
     ), gone AS (
       DELETE FROM public.profiles WHERE id = $1 AND (SELECT count(*) FROM moved) >= 0 RETURNING id
     ), audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, before_values)
       SELECT $2, $3, $4, 'profile.deleted', 'profile', id, $5, jsonb_build_object('name', $6::text, 'accounts_moved', (SELECT count(*) FROM moved)) FROM gone
     )
     SELECT count(*)::int AS moved FROM moved`,
    [profile.id, profile.workspace_id, member.actor_id, caller.entryPoint, `Deleted the profile ${profile.name}`, profile.name],
  );
  return { profile_id: profile.id, deleted: true, accounts_moved: Number(result?.moved ?? 0) };
}

// Puts an account in a profile, or in no profile when profile_id is null or "none".
export async function moveAccount(sql: Sql, caller: Caller, input: { account_id?: unknown; profile_id?: unknown }) {
  const accountId = requireUuid(input.account_id, "Account");
  const profileId = input.profile_id === null || input.profile_id === undefined || input.profile_id === "" || input.profile_id === "none" ? null : requireUuid(input.profile_id, "Profile");
  const [account] = await sql<{ id: string; workspace_id: string; platform: Platform; display_name: string; profile_id: string | null }>(
    `SELECT id, workspace_id, platform, display_name, profile_id FROM public.connected_accounts WHERE id = $1`,
    [accountId],
  );
  if (!account) throw new ApiError(404, "That account was not found.");
  const member = await membership(sql, caller, account.workspace_id, true, "Reviewers cannot change profiles.").catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That account was not found.");
    throw error;
  });
  let target: { id: string; name: string } | null = null;
  if (profileId) {
    [target] = await sql<{ id: string; name: string }>(`SELECT id, name FROM public.profiles WHERE id = $1 AND workspace_id = $2`, [profileId, account.workspace_id]);
    if (!target) throw new ApiError(404, "That profile was not found.");
  }
  if (account.profile_id === (target?.id ?? null)) return { account_id: accountId, profile_id: target?.id ?? null };
  const label = `${DISPLAY_NAMES[account.platform]} account ${account.display_name}`;
  await sql(
    `WITH moved AS (
       UPDATE public.connected_accounts SET profile_id = $2 WHERE id = $1 RETURNING id
     )
     INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, before_values, after_values)
     SELECT $3, $4, $5, 'account.moved', 'account', id, $6, jsonb_build_object('profile_id', $7::uuid), jsonb_build_object('profile_id', $2::uuid) FROM moved`,
    [accountId, target?.id ?? null, account.workspace_id, member.actor_id, caller.entryPoint, target ? `Moved ${label} to ${target.name}` : `Took ${label} out of its profile`, account.profile_id],
  );
  return { account_id: accountId, profile_id: target?.id ?? null };
}

// How an AI's TikTok posts reach this account: "direct" (the default) posts straight away;
// "inbox" sends each one to the creator's TikTok inbox to finish and post in TikTok.
export async function setTiktokDelivery(sql: Sql, caller: Caller, input: { account_id?: unknown; delivery?: unknown }) {
  const accountId = requireUuid(input.account_id, "Account");
  if (input.delivery !== "direct" && input.delivery !== "inbox") throw new ApiError(400, 'delivery must be "direct" or "inbox".');
  const delivery = input.delivery;
  const [account] = await sql<{ id: string; workspace_id: string; platform: Platform; display_name: string; tiktok_delivery: string }>(
    `SELECT id, workspace_id, platform, display_name, tiktok_delivery FROM public.connected_accounts WHERE id = $1`,
    [accountId],
  );
  if (!account) throw new ApiError(404, "That account was not found.");
  const member = await membership(sql, caller, account.workspace_id, true, "Reviewers cannot change accounts.").catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That account was not found.");
    throw error;
  });
  if (account.platform !== "tiktok") throw new ApiError(400, "Only TikTok accounts have this setting.");
  if (account.tiktok_delivery === delivery) return { account_id: accountId, tiktok_delivery: delivery };
  await sql(
    `WITH changed AS (
       UPDATE public.connected_accounts SET tiktok_delivery = $2 WHERE id = $1 RETURNING id
     )
     INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, before_values, after_values)
     SELECT $3, $4, $5, 'account.tiktok_delivery_changed', 'account', id, $6, jsonb_build_object('tiktok_delivery', $7::text), jsonb_build_object('tiktok_delivery', $2::text) FROM changed`,
    [
      accountId,
      delivery,
      account.workspace_id,
      member.actor_id,
      caller.entryPoint,
      delivery === "direct" ? `AI posts to TikTok account ${account.display_name} now post directly` : `AI posts to TikTok account ${account.display_name} now go to the TikTok inbox first`,
      account.tiktok_delivery,
    ],
  );
  return { account_id: accountId, tiktok_delivery: delivery };
}
