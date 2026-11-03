// The inbox: Instagram DMs (conversations), comments on the account's posts, and the people
// behind them (contacts). Reading is open to every member; replying, hiding and editing
// contacts are not open to reviewers. Replies are queued here and sent by the worker
// (worker/src/inbox/inbox.ts), which holds the accounts' access, usually within seconds.
import { ApiError, isAgentCaller, membership, requireUuid, type Caller } from "../access";
import { inboxOn, type InboxDeps } from "./automations";

const REPLY_WINDOW_HOURS = 24;
const PRIVATE_REPLY_DAYS = 7;
const MAX_TEXT = 1000;

const sentBy = (caller: Caller) => (isAgentCaller(caller) ? "agent" : "person");
const page = (input: { limit?: unknown; offset?: unknown }, max = 100) => ({
  limit: Math.min(max, Math.max(1, Number(input.limit ?? 50) || 50)),
  offset: Math.max(0, Number(input.offset ?? 0) || 0),
});

function message(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ApiError(400, "Write a message first.");
  if (text.length > MAX_TEXT) throw new ApiError(400, `Keep it to ${MAX_TEXT} characters.`);
  return text;
}

function requireOn(deps: InboxDeps, workspaceId: string) {
  if (!inboxOn(deps.inbox, workspaceId)) throw new ApiError(403, "The inbox isn't switched on for this workspace yet.");
}

// Finds a row's workspace, then checks the caller belongs to it (same "not found" either way).
async function owned<T extends { workspace_id: string }>(deps: InboxDeps, caller: Caller, rows: T[], what: string, write: boolean) {
  const row = rows[0];
  if (!row) throw new ApiError(404, `That ${what} was not found.`);
  const member = await membership(deps.sql, caller, row.workspace_id, write, "Reviewers can read the inbox but not reply.").catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, `That ${what} was not found.`);
    throw error;
  });
  requireOn(deps, row.workspace_id);
  return { row, member };
}

const CONTACT_JSON = `jsonb_build_object('id', ct.id, 'username', ct.username, 'name', ct.name, 'email', ct.email, 'tags', ct.tags)`;
const ACCOUNT_JSON = `jsonb_build_object('id', a.id, 'handle', a.handle, 'display_name', a.display_name)`;
const CAN_REPLY = `(cv.last_inbound_at IS NOT NULL AND cv.last_inbound_at > now() - interval '${REPLY_WINDOW_HOURS} hours')`;

// --- Messages -------------------------------------------------------------------------

export async function listConversations(deps: InboxDeps, caller: Caller, input: { workspace_id?: unknown; status?: unknown; account_id?: unknown; limit?: unknown; offset?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(deps.sql, caller, workspaceId, false);
  requireOn(deps, workspaceId);
  const status = input.status === "done" ? "done" : input.status === "all" ? null : "open";
  const accountId = input.account_id ? requireUuid(input.account_id, "Account") : null;
  const { limit, offset } = page(input);
  const conversations = await deps.sql(
    `SELECT cv.id, cv.status, cv.unread, cv.last_message_at, cv.last_inbound_at, cv.last_preview,
            ${CAN_REPLY} AS can_reply,
            CASE WHEN ${CAN_REPLY} THEN cv.last_inbound_at + interval '${REPLY_WINDOW_HOURS} hours' END AS reply_until,
            ${CONTACT_JSON} AS contact, ${ACCOUNT_JSON} AS account
     FROM public.conversations cv
     JOIN public.contacts ct ON ct.id = cv.contact_id
     JOIN public.connected_accounts a ON a.id = cv.connected_account_id
     WHERE cv.workspace_id = $1 AND ($2::text IS NULL OR cv.status = $2) AND ($3::uuid IS NULL OR cv.connected_account_id = $3)
     ORDER BY cv.last_message_at DESC LIMIT $4 OFFSET $5`,
    [workspaceId, status, accountId, limit, offset],
  );
  return { conversations };
}

export async function getConversation(deps: InboxDeps, caller: Caller, input: { conversation_id?: unknown; limit?: unknown }) {
  const id = requireUuid(input.conversation_id, "Conversation");
  const rows = await deps.sql<{ workspace_id: string }>(
    `SELECT cv.id, cv.workspace_id, cv.status, cv.unread, cv.last_message_at, cv.last_inbound_at,
            ${CAN_REPLY} AS can_reply,
            CASE WHEN ${CAN_REPLY} THEN cv.last_inbound_at + interval '${REPLY_WINDOW_HOURS} hours' END AS reply_until,
            ${CONTACT_JSON} AS contact, ${ACCOUNT_JSON} AS account
     FROM public.conversations cv JOIN public.contacts ct ON ct.id = cv.contact_id JOIN public.connected_accounts a ON a.id = cv.connected_account_id
     WHERE cv.id = $1`,
    [id],
  );
  const { row: conversation, member } = await owned(deps, caller, rows, "conversation", false);
  const { limit } = page(input, 200);
  const [messages, pending] = await Promise.all([
    deps.sql(
      `SELECT * FROM (SELECT id, direction, text, attachments, sent_by, created_at FROM public.messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2) m ORDER BY created_at`,
      [id, limit],
    ),
    deps.sql(`SELECT id, text, status, error, created_at FROM public.inbox_outbox WHERE conversation_id = $1 AND kind = 'message' AND status <> 'sent' ORDER BY created_at`, [id]),
  ]);
  // Opening a conversation reads it (not for reviewers, who can't change anything).
  if (member.role !== "reviewer") await deps.sql(`UPDATE public.conversations SET unread = 0 WHERE id = $1 AND unread > 0`, [id]);
  return { conversation, messages, pending };
}

export async function sendMessage(deps: InboxDeps, caller: Caller, input: { conversation_id?: unknown; text?: unknown }) {
  const id = requireUuid(input.conversation_id, "Conversation");
  const rows = await deps.sql<{ workspace_id: string; connected_account_id: string; can_reply: boolean }>(
    `SELECT cv.workspace_id, cv.connected_account_id, ${CAN_REPLY} AS can_reply FROM public.conversations cv WHERE cv.id = $1`,
    [id],
  );
  const { row, member } = await owned(deps, caller, rows, "conversation", true);
  if (!row.can_reply) throw new ApiError(409, `Instagram only allows replies within ${REPLY_WINDOW_HOURS} hours of their last message. You can reply once they message you again.`);
  const text = message(input.text);
  const [queued] = await deps.sql(
    `INSERT INTO public.inbox_outbox (workspace_id, connected_account_id, kind, conversation_id, text, sent_by, actor_id)
     VALUES ($1, $2, 'message', $3, $4, $5, $6) RETURNING id, status, created_at`,
    [row.workspace_id, row.connected_account_id, id, text, sentBy(caller), member.actor_id],
  );
  return { queued, next_step: "Sending now; it shows in the conversation within a few seconds." };
}

export async function setConversationStatus(deps: InboxDeps, caller: Caller, input: { conversation_id?: unknown; status?: unknown }) {
  const id = requireUuid(input.conversation_id, "Conversation");
  if (input.status !== "open" && input.status !== "done") throw new ApiError(400, "status must be open or done.");
  const rows = await deps.sql<{ workspace_id: string }>(`SELECT workspace_id FROM public.conversations WHERE id = $1`, [id]);
  await owned(deps, caller, rows, "conversation", true);
  await deps.sql(`UPDATE public.conversations SET status = $2, unread = CASE WHEN $2 = 'done' THEN 0 ELSE unread END WHERE id = $1`, [id, input.status]);
  return { conversation_id: id, status: input.status };
}

// --- Comments -------------------------------------------------------------------------

export async function listComments(deps: InboxDeps, caller: Caller, input: { workspace_id?: unknown; filter?: unknown; account_id?: unknown; platform_post_id?: unknown; limit?: unknown; offset?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(deps.sql, caller, workspaceId, false);
  requireOn(deps, workspaceId);
  const filter = ["all", "unreplied", "hidden"].includes(String(input.filter)) ? String(input.filter) : "all";
  const accountId = input.account_id ? requireUuid(input.account_id, "Account") : null;
  const postId = typeof input.platform_post_id === "string" && input.platform_post_id ? input.platform_post_id : null;
  const { limit, offset } = page(input);
  const comments = await deps.sql(
    `SELECT c.id, c.platform_comment_id, c.platform_post_id, c.commenter_username, c.text, c.hidden, c.replied_at, c.dm_sent_at, c.created_at, c.contact_id,
            (c.dm_sent_at IS NULL AND c.created_at > now() - interval '${PRIVATE_REPLY_DAYS} days') AS can_dm,
            ${ACCOUNT_JSON} AS account,
            (SELECT left(p.caption, 120) FROM public.destinations d JOIN public.posts p ON p.id = d.post_id
             WHERE d.connected_account_id = c.connected_account_id AND d.platform_request_id = c.platform_post_id LIMIT 1) AS post_caption,
            (SELECT d.live_url FROM public.destinations d WHERE d.connected_account_id = c.connected_account_id AND d.platform_request_id = c.platform_post_id LIMIT 1) AS post_url,
            (SELECT jsonb_agg(jsonb_build_object('kind', o.kind, 'status', o.status, 'error', o.error) ORDER BY o.created_at)
             FROM public.inbox_outbox o WHERE o.comment_id = c.id AND o.status <> 'sent') AS pending
     FROM public.inbox_comments c JOIN public.connected_accounts a ON a.id = c.connected_account_id
     WHERE c.workspace_id = $1 AND NOT c.from_account
       AND ($2 = 'all' OR ($2 = 'unreplied' AND c.replied_at IS NULL AND c.dm_sent_at IS NULL AND NOT c.hidden) OR ($2 = 'hidden' AND c.hidden))
       AND ($3::uuid IS NULL OR c.connected_account_id = $3) AND ($4::text IS NULL OR c.platform_post_id = $4)
     ORDER BY c.created_at DESC LIMIT $5 OFFSET $6`,
    [workspaceId, filter, accountId, postId, limit, offset],
  );
  return { comments };
}

type CommentRow = { workspace_id: string; connected_account_id: string; dm_sent_at: string | null; created_at: string; hidden: boolean };
async function commentFor(deps: InboxDeps, caller: Caller, commentId: unknown) {
  const id = requireUuid(commentId, "Comment");
  const rows = await deps.sql<CommentRow>(`SELECT workspace_id, connected_account_id, dm_sent_at, created_at, hidden FROM public.inbox_comments WHERE id = $1`, [id]);
  const { row, member } = await owned(deps, caller, rows, "comment", true);
  return { id, comment: row, member };
}

async function queueForComment(deps: InboxDeps, caller: Caller, kind: string, input: { comment_id?: unknown }, text: string | null) {
  const { id, comment, member } = await commentFor(deps, caller, input.comment_id);
  if (kind === "private_reply") {
    if (comment.dm_sent_at) throw new ApiError(409, "This commenter already got a DM for this comment. Instagram allows one per comment.");
    if (Date.now() - Date.parse(comment.created_at) > PRIVATE_REPLY_DAYS * 86_400_000) throw new ApiError(409, `Instagram only allows a DM to a commenter within ${PRIVATE_REPLY_DAYS} days of the comment.`);
    const [{ n }] = await deps.sql<{ n: number }>(`SELECT count(*)::int AS n FROM public.inbox_outbox WHERE comment_id = $1 AND kind = 'private_reply' AND status = 'queued'`, [id]);
    if (n) throw new ApiError(409, "A DM to this commenter is already on its way.");
  }
  const [queued] = await deps.sql(
    `INSERT INTO public.inbox_outbox (workspace_id, connected_account_id, kind, comment_id, text, sent_by, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, kind, status, created_at`,
    [comment.workspace_id, comment.connected_account_id, kind, id, text, sentBy(caller), member.actor_id],
  );
  return { queued, next_step: "Sending now; it updates in the inbox within a few seconds." };
}

export const replyToComment = (deps: InboxDeps, caller: Caller, input: { comment_id?: unknown; text?: unknown }) => queueForComment(deps, caller, "comment_reply", input, message(input.text));
export const dmCommenter = (deps: InboxDeps, caller: Caller, input: { comment_id?: unknown; text?: unknown }) => queueForComment(deps, caller, "private_reply", input, message(input.text));
export const hideComment = (deps: InboxDeps, caller: Caller, input: { comment_id?: unknown; hidden?: unknown }) =>
  queueForComment(deps, caller, input.hidden === false ? "unhide_comment" : "hide_comment", input, null);

// --- Contacts -------------------------------------------------------------------------

const TAG = /^[\p{L}\p{N} _-]{1,40}$/u;
function cleanTags(value: unknown) {
  if (!Array.isArray(value)) throw new ApiError(400, "Tags must be a list.");
  const tags = [...new Set(value.map((t) => (typeof t === "string" ? t.trim().toLowerCase() : "")).filter(Boolean))];
  if (tags.length > 20) throw new ApiError(400, "Use up to 20 tags.");
  if (tags.some((t) => !TAG.test(t))) throw new ApiError(400, "Tags are words up to 40 characters.");
  return tags;
}
function cleanEmail(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || value.length > 254) throw new ApiError(400, "That email address doesn't look right.");
  return value.trim().toLowerCase();
}

export async function listContacts(deps: InboxDeps, caller: Caller, input: { workspace_id?: unknown; search?: unknown; tag?: unknown; account_id?: unknown; limit?: unknown; offset?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(deps.sql, caller, workspaceId, false);
  requireOn(deps, workspaceId);
  const search = typeof input.search === "string" && input.search.trim() ? `%${input.search.trim().toLowerCase().replace(/[%_]/g, "")}%` : null;
  const tag = typeof input.tag === "string" && input.tag.trim() ? input.tag.trim().toLowerCase() : null;
  const accountId = input.account_id ? requireUuid(input.account_id, "Account") : null;
  const { limit, offset } = page(input);
  const contacts = await deps.sql(
    `SELECT ct.id, ct.username, ct.name, ct.email, ct.tags, ct.notes, ct.source, ct.first_seen_at, ct.last_seen_at, ${ACCOUNT_JSON} AS account,
            (SELECT count(*)::int FROM public.inbox_comments c WHERE c.contact_id = ct.id) AS comments,
            (SELECT cv.id FROM public.conversations cv WHERE cv.contact_id = ct.id LIMIT 1) AS conversation_id,
            EXISTS (SELECT 1 FROM public.automation_runs r WHERE r.connected_account_id = ct.connected_account_id AND r.commenter_id = ct.platform_user_id AND r.status = 'sent') AS got_automation_dm
     FROM public.contacts ct JOIN public.connected_accounts a ON a.id = ct.connected_account_id
     WHERE ct.workspace_id = $1
       AND ($2::text IS NULL OR lower(coalesce(ct.username, '')) LIKE $2 OR lower(coalesce(ct.name, '')) LIKE $2 OR lower(coalesce(ct.email, '')) LIKE $2)
       AND ($3::text IS NULL OR $3 = ANY(ct.tags)) AND ($6::uuid IS NULL OR ct.connected_account_id = $6)
     ORDER BY ct.last_seen_at DESC LIMIT $4 OFFSET $5`,
    [workspaceId, search, tag, limit, offset, accountId],
  );
  return { contacts };
}

export async function updateContact(deps: InboxDeps, caller: Caller, input: { contact_id?: unknown; email?: unknown; tags?: unknown; notes?: unknown }) {
  const id = requireUuid(input.contact_id, "Contact");
  const rows = await deps.sql<{ workspace_id: string; email: string | null; tags: string[]; notes: string | null }>(`SELECT workspace_id, email, tags, notes FROM public.contacts WHERE id = $1`, [id]);
  const { row } = await owned(deps, caller, rows, "contact", true);
  const notes = input.notes === undefined ? row.notes : typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) || null : null;
  const [contact] = await deps.sql(
    `UPDATE public.contacts SET email = $2, tags = $3, notes = $4 WHERE id = $1 RETURNING id, username, name, email, tags, notes`,
    [id, input.email === undefined ? row.email : cleanEmail(input.email), input.tags === undefined ? row.tags : cleanTags(input.tags), notes],
  );
  return { contact };
}
