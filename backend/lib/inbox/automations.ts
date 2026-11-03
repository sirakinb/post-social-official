// Comment-to-DM automations: someone comments a keyword on an Instagram or Facebook Page post and gets a DM
// (with up to 3 link buttons), plus an optional public reply. Open to anyone who can connect
// accounts (not reviewers); every change is audited. The worker does the sending
// (worker/src/inbox/runner.ts).
import { ApiError, membership, requireUuid, type Caller, type Sql } from "../access";
import type { MatchMode } from "./match";

// Where automations are switched on: INBOX_WORKSPACES lists workspace ids, or "all".
// INBOX_HUMAN_AGENT lists the platforms whose Human Agent permission is approved: there a
// person (not an automation or agent) may reply up to 7 days after the last message.
export type InboxSwitch = { all: boolean; workspaces: string[]; humanAgent?: string[] };
export const HUMAN_AGENT_PLATFORMS = ["instagram", "facebook"];
export function inboxSwitch(setting: (name: string) => string | undefined): InboxSwitch {
  const read = (name: string) => {
    try {
      return setting(name) ?? "";
    } catch {
      return ""; // not set
    }
  };
  const list = read("INBOX_WORKSPACES").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const humanAgent = read("INBOX_HUMAN_AGENT").split(",").map((p) => p.trim().toLowerCase()).filter((p) => HUMAN_AGENT_PLATFORMS.includes(p));
  return { all: list.includes("all"), workspaces: list.filter((w) => w !== "all"), humanAgent };
}
export const inboxOn = (on: InboxSwitch, workspaceId: string) => on.all || on.workspaces.includes(workspaceId.toLowerCase());

export type InboxDeps = { sql: Sql; inbox: InboxSwitch };

export const MATCH_MODES: MatchMode[] = ["word", "contains", "exact"];
export const LIMITS = { name: 80, keywords: 20, keyword: 50, dm: 640, variations: 5, buttons: 3, buttonLabel: 20, reply: 300 };
const MAX_AUTOMATIONS = 100;

export type Button = { label: string; url: string };
export type Automation = {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  name: string;
  platform_post_id: string | null;
  post_id: string | null;
  keywords: string[];
  match_mode: MatchMode;
  exclude_keywords: string[];
  dm_message: string;
  dm_variations: string[];
  dm_buttons: Button[];
  comment_reply: string | null;
  comment_reply_variations: string[];
  repeat_mode: "once" | "every_comment";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
const COLUMNS =
  "id, workspace_id, connected_account_id, name, platform_post_id, post_id, keywords, match_mode, exclude_keywords, dm_message, dm_variations, dm_buttons, comment_reply, comment_reply_variations, repeat_mode, is_active, created_at, updated_at";
const prefixed = (alias: string) => COLUMNS.split(", ").map((c) => `${alias}.${c}`).join(", ");

// Per automation: comments it matched, DMs sent, failed and skipped, link clicks and the
// people who clicked.
const STATS_SQL = (alias: string) => `
  (SELECT count(*)::int FROM public.automation_runs r WHERE r.automation_id = ${alias}.id) AS triggered,
  (SELECT count(*)::int FROM public.automation_runs r WHERE r.automation_id = ${alias}.id AND r.status = 'sent') AS sent,
  (SELECT count(*)::int FROM public.automation_runs r WHERE r.automation_id = ${alias}.id AND r.status = 'failed') AS failed,
  (SELECT count(*)::int FROM public.automation_runs r WHERE r.automation_id = ${alias}.id AND r.status = 'skipped') AS skipped,
  (SELECT coalesce(sum(l.clicks), 0)::int FROM public.tracked_links l WHERE l.automation_id = ${alias}.id) AS clicks,
  (SELECT count(DISTINCT l.run_id)::int FROM public.tracked_links l WHERE l.automation_id = ${alias}.id AND l.clicks > 0) AS people_clicked`;

const ACCOUNT_SQL = `(SELECT jsonb_build_object('id', a.id, 'platform', a.platform, 'handle', a.handle, 'display_name', a.display_name, 'health', a.health)
   FROM public.connected_accounts a WHERE a.id = c.connected_account_id) AS account`;

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ApiError(400, `Add ${label}.`);
    return null;
  }
  if (typeof value !== "string") throw new ApiError(400, `${label[0].toUpperCase()}${label.slice(1)} must be text.`);
  const trimmed = value.trim();
  if (!trimmed && required) throw new ApiError(400, `Add ${label}.`);
  if (trimmed.length > max) throw new ApiError(400, `Keep ${label} to ${max} characters.`);
  return trimmed || null;
}

function words(value: unknown, label: string, max: number) {
  if (value === undefined || value === null) return [];
  const list = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(list)) throw new ApiError(400, `${label} must be a list of words.`);
  const cleaned = [...new Set(list.map((k) => (typeof k === "string" ? k.trim().replace(/\s+/g, " ") : "")).filter(Boolean).map((k) => k.toLowerCase()))];
  if (cleaned.length > max) throw new ApiError(400, `Use up to ${max} ${label.toLowerCase()}.`);
  const long = cleaned.find((k) => k.length > LIMITS.keyword);
  if (long) throw new ApiError(400, `Keep each keyword to ${LIMITS.keyword} characters.`);
  return cleaned;
}

function variations(value: unknown, label: string, max: number) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiError(400, `${label} must be a list.`);
  const cleaned = value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  if (cleaned.length > LIMITS.variations) throw new ApiError(400, `Use up to ${LIMITS.variations} ${label.toLowerCase()}.`);
  if (cleaned.some((v) => v.length > max)) throw new ApiError(400, `Keep each of the ${label.toLowerCase()} to ${max} characters.`);
  return cleaned;
}

export function cleanButtons(value: unknown): Button[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiError(400, "Buttons must be a list of { label, url }.");
  if (value.length > LIMITS.buttons) throw new ApiError(400, `A DM can have up to ${LIMITS.buttons} buttons.`);
  return value.map((b, i) => {
    const item = (b ?? {}) as Record<string, unknown>;
    const label = text(item.label, `button ${i + 1}'s label`, LIMITS.buttonLabel, true)!;
    const raw = text(item.url, `button ${i + 1}'s link`, 2000, true)!;
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      throw new ApiError(400, `Button ${i + 1}'s link isn't a web address.`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ApiError(400, `Button ${i + 1}'s link must start with https://.`);
    return { label, url: url.toString() };
  });
}

function matchMode(value: unknown): MatchMode {
  if (value === undefined || value === null || value === "") return "word";
  if (!MATCH_MODES.includes(value as MatchMode)) throw new ApiError(400, `match_mode must be one of: ${MATCH_MODES.join(", ")}.`);
  return value as MatchMode;
}

function repeatMode(value: unknown): Automation["repeat_mode"] {
  if (value === undefined || value === null || value === "") return "once";
  if (value !== "once" && value !== "every_comment") throw new ApiError(400, "repeat_mode must be once or every_comment.");
  return value;
}

function postId(value: unknown) {
  const id = text(value, "the post id", 64, false);
  if (id && !/^[0-9A-Za-z_]+$/.test(id)) throw new ApiError(400, "The post id isn't valid.");
  return id;
}

type Values = Omit<Automation, "id" | "workspace_id" | "connected_account_id" | "is_active" | "created_at" | "updated_at" | "post_id">;
// Threads has no DMs: there an automation answers with the public reply only.
function cleanValues(input: Record<string, unknown>, platform: string, before?: Automation): Values {
  const publicOnly = platform === "threads";
  const pick = <K extends keyof Values>(key: K, clean: (v: unknown) => Values[K]) => (input[key] === undefined && before ? before[key] : clean(input[key]));
  const values: Values = {
    name: pick("name", (v) => text(v, "a name", LIMITS.name, true)!),
    platform_post_id: pick("platform_post_id", postId),
    keywords: pick("keywords", (v) => words(v, "Keywords", LIMITS.keywords)),
    match_mode: pick("match_mode", matchMode),
    exclude_keywords: pick("exclude_keywords", (v) => words(v, "Excluded words", LIMITS.keywords)),
    dm_message: publicOnly ? "" : pick("dm_message", (v) => text(v, "the DM", LIMITS.dm, true)!),
    dm_variations: publicOnly ? [] : pick("dm_variations", (v) => variations(v, "DM variations", LIMITS.dm)),
    dm_buttons: publicOnly ? [] : pick("dm_buttons", cleanButtons),
    comment_reply: pick("comment_reply", (v) => text(v, "the public reply", LIMITS.reply, false)),
    comment_reply_variations: pick("comment_reply_variations", (v) => variations(v, "Reply variations", LIMITS.reply)),
    repeat_mode: pick("repeat_mode", repeatMode),
  };
  if (values.comment_reply_variations.length && !values.comment_reply) throw new ApiError(400, "Add the public reply before its variations.");
  if (publicOnly && !values.comment_reply) throw new ApiError(400, "Threads has no DMs, so a Threads automation needs the public reply.");
  return values;
}

function requireOn(deps: InboxDeps, workspaceId: string) {
  if (!inboxOn(deps.inbox, workspaceId)) throw new ApiError(403, "Automations aren't switched on for this workspace yet.");
}

async function automationFor(deps: InboxDeps, caller: Caller, automationId: unknown, write: boolean) {
  const id = requireUuid(automationId, "Automation");
  const [automation] = await deps.sql<Automation>(`SELECT ${COLUMNS} FROM public.comment_automations WHERE id = $1`, [id]);
  if (!automation) throw new ApiError(404, "That automation was not found.");
  const member = await membership(deps.sql, caller, automation.workspace_id, write, "Reviewers cannot change automations.").catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That automation was not found.");
    throw error;
  });
  requireOn(deps, automation.workspace_id);
  return { automation, member };
}

// The account must be an Instagram account, Facebook Page or Threads account in this workspace that is still connected.
async function inboxAccount(sql: Sql, workspaceId: string, accountId: unknown) {
  const id = requireUuid(accountId, "Account");
  const [account] = await sql<{ id: string; platform: string; health: string }>(
    `SELECT id, platform, health FROM public.connected_accounts WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  if (!account) throw new ApiError(404, "That account was not found in this workspace.");
  if (!["instagram", "facebook", "threads"].includes(account.platform)) throw new ApiError(400, "Automations work on Instagram, Facebook Pages and Threads.");
  if (account.health === "disconnected") throw new ApiError(409, "That account is disconnected. Reconnect it first.");
  return account;
}

// Our post id for an Instagram or Facebook post, when it was published through Post Social.
async function ourPostId(sql: Sql, accountId: string, platformPostId: string | null) {
  if (!platformPostId) return null;
  const [row] = await sql<{ post_id: string }>(
    `SELECT post_id FROM public.destinations WHERE connected_account_id = $1 AND platform_request_id = $2 LIMIT 1`,
    [accountId, platformPostId],
  );
  return row?.post_id ?? null;
}

export async function listAutomations(deps: InboxDeps, caller: Caller, input: { workspace_id?: unknown; account_id?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(deps.sql, caller, workspaceId, false);
  if (!inboxOn(deps.inbox, workspaceId)) return { enabled: false, automations: [] };
  const accountId = input.account_id === undefined || input.account_id === "" ? null : requireUuid(input.account_id, "Account");
  const automations = await deps.sql(
    `SELECT ${prefixed("c")}, ${ACCOUNT_SQL}, ${STATS_SQL("c")}
     FROM public.comment_automations c
     WHERE c.workspace_id = $1 AND ($2::uuid IS NULL OR c.connected_account_id = $2)
     ORDER BY c.created_at DESC LIMIT 200`,
    [workspaceId, accountId],
  );
  return { enabled: true, automations };
}

export async function getAutomation(deps: InboxDeps, caller: Caller, input: { automation_id?: unknown; limit?: unknown }) {
  const { automation } = await automationFor(deps, caller, input.automation_id, false);
  const limit = Math.min(100, Math.max(1, Number(input.limit ?? 50) || 50));
  const [withStats] = await deps.sql(`SELECT ${prefixed("c")}, ${ACCOUNT_SQL}, ${STATS_SQL("c")} FROM public.comment_automations c WHERE c.id = $1`, [automation.id]);
  const activity = await deps.sql(
    `SELECT r.id, r.platform_comment_id, r.platform_post_id, r.commenter_username, r.comment_text, r.status, r.reason, r.dm_text, r.reply_status, r.created_at,
            coalesce((SELECT sum(l.clicks) FROM public.tracked_links l WHERE l.run_id = r.id), 0)::int AS clicks
     FROM public.automation_runs r WHERE r.automation_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
    [automation.id, limit],
  );
  return { automation: withStats, activity };
}

export async function createAutomation(deps: InboxDeps, caller: Caller, input: Record<string, unknown>) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  const member = await membership(deps.sql, caller, workspaceId, true, "Reviewers cannot change automations.");
  requireOn(deps, workspaceId);
  const account = await inboxAccount(deps.sql, workspaceId, input.account_id);
  const values = cleanValues(input, account.platform);
  const [{ count }] = await deps.sql<{ count: number }>(`SELECT count(*)::int AS count FROM public.comment_automations WHERE workspace_id = $1`, [workspaceId]);
  if (Number(count) >= MAX_AUTOMATIONS) throw new ApiError(409, `A workspace can have up to ${MAX_AUTOMATIONS} automations.`);
  const post = await ourPostId(deps.sql, account.id, values.platform_post_id);
  const active = input.is_active === undefined ? true : Boolean(input.is_active);
  const [automation] = await deps.sql<Automation>(
    `WITH created AS (
       INSERT INTO public.comment_automations (workspace_id, connected_account_id, name, platform_post_id, post_id, keywords, match_mode, exclude_keywords,
         dm_message, dm_variations, dm_buttons, comment_reply, comment_reply_variations, repeat_mode, is_active, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
       RETURNING ${COLUMNS}
     ), subscribe AS (
       INSERT INTO public.inbox_accounts (connected_account_id, workspace_id) SELECT connected_account_id, workspace_id FROM created
       ON CONFLICT (connected_account_id) DO UPDATE SET next_attempt_at = CASE WHEN inbox_accounts.subscribed_at IS NULL THEN now() ELSE inbox_accounts.next_attempt_at END
     ), audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       SELECT $1, $16, $17, 'automation.created', 'automation', id, 'Created the automation ' || name,
              jsonb_build_object('keywords', keywords, 'platform_post_id', platform_post_id, 'is_active', is_active) FROM created
     )
     SELECT * FROM created`,
    [workspaceId, account.id, values.name, values.platform_post_id, post, values.keywords, values.match_mode, values.exclude_keywords,
      values.dm_message, values.dm_variations, JSON.stringify(values.dm_buttons), values.comment_reply, values.comment_reply_variations, values.repeat_mode, active,
      member.actor_id, caller.entryPoint],
  );
  return { automation };
}

export async function updateAutomation(deps: InboxDeps, caller: Caller, input: Record<string, unknown>) {
  const { automation: before, member } = await automationFor(deps, caller, input.automation_id, true);
  const [{ platform }] = await deps.sql<{ platform: string }>(`SELECT platform FROM public.connected_accounts WHERE id = $1`, [before.connected_account_id]);
  const values = cleanValues(input, platform, before);
  const active = input.is_active === undefined ? before.is_active : Boolean(input.is_active);
  const post = values.platform_post_id === before.platform_post_id ? before.post_id : await ourPostId(deps.sql, before.connected_account_id, values.platform_post_id);
  const [automation] = await deps.sql<Automation>(
    `WITH updated AS (
       UPDATE public.comment_automations SET name = $2, platform_post_id = $3, post_id = $4, keywords = $5, match_mode = $6, exclude_keywords = $7,
         dm_message = $8, dm_variations = $9, dm_buttons = $10::jsonb, comment_reply = $11, comment_reply_variations = $12, repeat_mode = $13, is_active = $14
       WHERE id = $1
       RETURNING ${COLUMNS}
     ), subscribe AS (
       UPDATE public.inbox_accounts SET next_attempt_at = now()
       WHERE connected_account_id = (SELECT connected_account_id FROM updated) AND subscribed_at IS NULL AND (SELECT is_active FROM updated)
     ), audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       SELECT workspace_id, $15, $16, 'automation.updated', 'automation', id,
              CASE WHEN is_active <> $17 THEN (CASE WHEN is_active THEN 'Turned on the automation ' ELSE 'Paused the automation ' END) || name ELSE 'Edited the automation ' || name END,
              jsonb_build_object('keywords', keywords, 'platform_post_id', platform_post_id, 'is_active', is_active) FROM updated
     )
     SELECT * FROM updated`,
    [before.id, values.name, values.platform_post_id, post, values.keywords, values.match_mode, values.exclude_keywords, values.dm_message, values.dm_variations,
      JSON.stringify(values.dm_buttons), values.comment_reply, values.comment_reply_variations, values.repeat_mode, active, member.actor_id, caller.entryPoint, before.is_active],
  );
  return { automation };
}

export async function deleteAutomation(deps: InboxDeps, caller: Caller, input: { automation_id?: unknown }) {
  const { automation, member } = await automationFor(deps, caller, input.automation_id, true);
  await deps.sql(
    `WITH removed AS (DELETE FROM public.comment_automations WHERE id = $1 RETURNING id, workspace_id, name)
     INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary)
     SELECT workspace_id, $2, $3, 'automation.deleted', 'automation', id, 'Deleted the automation ' || name FROM removed`,
    [automation.id, member.actor_id, caller.entryPoint],
  );
  return { deleted: true, automation_id: automation.id };
}

// The posts an automation can be attached to: recent posts published through
// Post Social on that account.
export async function automationPosts(deps: InboxDeps, caller: Caller, input: { workspace_id?: unknown; account_id?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(deps.sql, caller, workspaceId, false);
  const account = await inboxAccount(deps.sql, workspaceId, input.account_id);
  const posts = await deps.sql(
    `SELECT d.platform_request_id AS platform_post_id, d.post_id, d.live_url, d.updated_at AS published_at, left(p.caption, 120) AS caption
     FROM public.destinations d JOIN public.posts p ON p.id = d.post_id
     WHERE d.connected_account_id = $1 AND d.status = 'published' AND d.platform_request_id IS NOT NULL
     ORDER BY d.updated_at DESC LIMIT 50`,
    [account.id],
  );
  return { posts };
}
