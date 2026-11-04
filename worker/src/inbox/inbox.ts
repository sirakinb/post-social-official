// The inbox side of Meta's webhooks (backend/lib/inbox/inbox.ts): stores every comment and DM
// with the person behind it, and sends the replies people queue in Post Social (a DM, a
// public comment reply, a DM to a commenter, hiding a comment).
import { accountFor, fromAccount, graph, GraphError, META, PLATFORM_NAME, threadsReply, tokenFor, type Account, type CommentValue, type InboxDeps, type InboxPlatform } from "./runner";

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000; // Meta: reply within 24 hours of their last message
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // one DM per comment, within 7 days
const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // a person's reply, with Meta's HUMAN_AGENT tag

// Platforms whose Human Agent permission is approved (INBOX_HUMAN_AGENT).
const humanAgentOn = (deps: InboxDeps, platform: string) => {
  let raw = "";
  try {
    raw = deps.setting("INBOX_HUMAN_AGENT") ?? "";
  } catch {
    // not set
  }
  return raw.split(",").map((p) => p.trim().toLowerCase()).includes(platform);
};

export type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; attachments?: Array<{ type?: string; payload?: { url?: string } }> };
  postback?: { mid?: string; title?: string; payload?: string };
};

const isOwn = (account: Account, id: string | null | undefined) => Boolean(id) && (id === account.webhook_id || id === account.external_account_id);

async function upsertContact(deps: InboxDeps, account: Account, userId: string, username: string | null, source: "comment" | "message", name: string | null = null) {
  const [contact] = await deps.sql<{ id: string }>(
    `INSERT INTO public.contacts (workspace_id, connected_account_id, platform, platform_user_id, username, source, name)
     VALUES ($1, $2, $6, $3, $4, $5, $7)
     ON CONFLICT (connected_account_id, platform_user_id) DO UPDATE
       SET last_seen_at = now(), username = coalesce(EXCLUDED.username, contacts.username), name = coalesce(EXCLUDED.name, contacts.name)
     RETURNING id`,
    [account.workspace_id, account.id, userId, username, source, account.platform ?? "instagram", name],
  );
  return contact.id;
}

async function upsertConversation(deps: InboxDeps, account: Account, contactId: string) {
  const [conversation] = await deps.sql<{ id: string }>(
    `INSERT INTO public.conversations (workspace_id, connected_account_id, contact_id) VALUES ($1, $2, $3)
     ON CONFLICT (connected_account_id, contact_id) DO UPDATE SET status = conversations.status
     RETURNING id`,
    [account.workspace_id, account.id, contactId],
  );
  return conversation.id;
}

const preview = (text: string | null, attachments: unknown[]) => (text ? text.slice(0, 140) : attachments.length ? "Sent an attachment" : null);

// Adds a message to a conversation (once per platform id) and moves the conversation on.
// Our own send can be recorded after the platform's echo of it (which has no text for link
// buttons): it fills that row in. Anything else seen twice is left alone.
async function addMessage(
  deps: InboxDeps,
  account: Account,
  conversationId: string,
  m: { direction: "in" | "out"; mid: string | null; text: string | null; attachments: unknown[]; sentBy: string; actorId: string | null; at: Date },
) {
  const [inserted] = await deps.sql<{ id: string }>(
    `INSERT INTO public.messages (workspace_id, conversation_id, direction, platform_message_id, text, attachments, sent_by, actor_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     ON CONFLICT (conversation_id, platform_message_id) WHERE platform_message_id IS NOT NULL DO UPDATE
       SET text = coalesce(nullif(messages.text, ''), EXCLUDED.text), sent_by = EXCLUDED.sent_by, actor_id = EXCLUDED.actor_id
       WHERE messages.direction = 'out' AND EXCLUDED.sent_by IN ('automation', 'person', 'agent') AND messages.sent_by NOT IN ('automation', 'person', 'agent')
     RETURNING id`,
    [account.workspace_id, conversationId, m.direction, m.mid, m.text, JSON.stringify(m.attachments), m.sentBy, m.actorId, m.at.toISOString()],
  );
  if (!inserted) return false;
  await deps.sql(
    `UPDATE public.conversations SET last_message_at = greatest(last_message_at, $2), last_preview = $3,
       last_inbound_at = CASE WHEN $4 = 'in' THEN greatest(coalesce(last_inbound_at, $2), $2) ELSE last_inbound_at END,
       unread = CASE WHEN $4 = 'in' THEN unread + 1 ELSE unread END,
       status = CASE WHEN $4 = 'in' THEN 'open' ELSE status END
     WHERE id = $1`,
    [conversationId, m.at.toISOString(), preview(m.text, m.attachments), m.direction],
  );
  return true;
}

// A comment on one of the account's posts: kept for the Comments tab, with its contact.
export async function recordComment(deps: InboxDeps, entryId: string, comment: CommentValue, platform: InboxPlatform = "instagram") {
  if (!comment.id) return;
  const account = await accountFor(deps, entryId, platform);
  if (!account) return;
  const own = fromAccount(account, comment.from);
  const contactId = !own && comment.from?.id ? await upsertContact(deps, account, comment.from.id, comment.from.username ?? null, "comment", comment.from.name ?? null) : null;
  await deps.sql(
    `INSERT INTO public.inbox_comments (workspace_id, connected_account_id, contact_id, platform_comment_id, platform_post_id, parent_comment_id, commenter_id, commenter_username, text, from_account)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (connected_account_id, platform_comment_id) DO UPDATE SET text = EXCLUDED.text
       WHERE coalesce(inbox_comments.text, '') = '' AND EXCLUDED.text <> ''`,
    [account.workspace_id, account.id, contactId, comment.id, comment.media?.id ?? null, comment.parent_id ?? null, comment.from?.id ?? null, comment.from?.username ?? comment.from?.name ?? null,
      (comment.text ?? "").slice(0, 2200), own],
  );
}

// A DM, either way: from a person (inbound), or from the account itself in the platform's app
// (an "echo"; ours are already recorded, so only unknown ones are added).
export async function recordMessage(deps: InboxDeps, entryId: string, event: MessagingEvent, platform: InboxPlatform = "instagram") {
  const account = await accountFor(deps, entryId, platform);
  if (!account) return;
  const message = event.message;
  const postback = event.postback;
  if (!message && !postback) return; // reads, reactions and typing aren't kept
  if (message?.is_deleted) return;
  const outgoing = Boolean(message?.is_echo) || isOwn(account, event.sender?.id);
  const other = outgoing ? event.recipient?.id : event.sender?.id;
  if (!other) return;
  const contactId = await upsertContact(deps, account, other, null, "message");
  const conversationId = await upsertConversation(deps, account, contactId);
  const attachments = (message?.attachments ?? []).map((a) => ({ type: a.type ?? "file", url: a.payload?.url ?? null }));
  await addMessage(deps, account, conversationId, {
    direction: outgoing ? "out" : "in",
    mid: message?.mid ?? postback?.mid ?? null,
    text: message?.text ?? (postback?.title ? `Tapped “${postback.title}”` : null),
    attachments,
    sentBy: outgoing ? "instagram" : "contact",
    actorId: null,
    at: event.timestamp ? new Date(event.timestamp) : new Date(),
  });
}

// An automation's or a person's DM to a commenter, shown in that person's conversation.
export async function recordOutgoing(
  deps: InboxDeps,
  account: Account,
  userId: string,
  username: string | null,
  text: string,
  sentBy: "automation" | "person" | "agent",
  actorId: string | null,
  comment?: { commentId: string; replied?: boolean },
  mid: string | null = null,
  name: string | null = null,
) {
  const contactId = await upsertContact(deps, account, userId, username, "comment", name);
  const conversationId = await upsertConversation(deps, account, contactId);
  await addMessage(deps, account, conversationId, { direction: "out", mid, text, attachments: [], sentBy, actorId, at: new Date() });
  if (comment) {
    await deps.sql(
      `UPDATE public.inbox_comments SET dm_sent_at = coalesce(dm_sent_at, now()), replied_at = CASE WHEN $3 THEN coalesce(replied_at, now()) ELSE replied_at END
       WHERE connected_account_id = $1 AND platform_comment_id = $2`,
      [account.id, comment.commentId, Boolean(comment.replied)],
    );
  }
}

// Names and handles for people who messaged first (Meta's DM events carry only an id).
export async function fillContactProfiles(deps: InboxDeps) {
  const due = await deps.sql<{ id: string; platform_user_id: string; connected_account_id: string; display_name: string; platform: InboxPlatform }>(
    `SELECT c.id, c.platform_user_id, c.connected_account_id, a.display_name, a.platform FROM public.contacts c
     JOIN public.connected_accounts a ON a.id = c.connected_account_id
     WHERE c.username IS NULL AND c.name IS NULL AND c.profile_checked_at IS NULL AND a.health <> 'disconnected'
       AND a.platform IN ('instagram', 'facebook') LIMIT 10`,
    [],
  );
  let filled = 0;
  for (const contact of due) {
    try {
      const token = await tokenFor(deps, { id: contact.connected_account_id, display_name: contact.display_name, platform: contact.platform });
      const profile = await graph(deps, token, `${encodeURIComponent(contact.platform_user_id)}?fields=${META[contact.platform].profile}`, { platform: contact.platform });
      await deps.sql(`UPDATE public.contacts SET username = $2, name = $3, profile_checked_at = now() WHERE id = $1`, [contact.id, profile.username ?? null, profile.name ?? null]);
      filled++;
    } catch {
      await deps.sql(`UPDATE public.contacts SET profile_checked_at = now() WHERE id = $1`, [contact.id]);
    }
  }
  return filled;
}

type Outbox = {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  kind: "message" | "comment_reply" | "private_reply" | "hide_comment" | "unhide_comment" | "delete_comment";
  conversation_id: string | null;
  comment_id: string | null;
  text: string | null;
  sent_by: "person" | "agent";
  actor_id: string | null;
};

async function sendOne(deps: InboxDeps, item: Outbox) {
  const [account] = await deps.sql<Account>(
    `SELECT a.id, a.workspace_id, a.platform, a.display_name, a.external_account_id, a.handle, ia.webhook_id
     FROM public.connected_accounts a LEFT JOIN public.inbox_accounts ia ON ia.connected_account_id = a.id WHERE a.id = $1`,
    [item.connected_account_id],
  );
  if (!account) throw new GraphError("The account is no longer connected.");
  const token = await tokenFor(deps, account);
  const platform = account.platform;
  const name = PLATFORM_NAME[platform] ?? "Instagram";

  if (platform === "threads" && (item.kind === "message" || item.kind === "private_reply")) throw new GraphError("Threads has no DMs.");

  if (item.kind === "message") {
    const [c] = await deps.sql<{ platform_user_id: string; last_inbound_at: string | null; username: string | null }>(
      `SELECT ct.platform_user_id, cv.last_inbound_at, ct.username FROM public.conversations cv JOIN public.contacts ct ON ct.id = cv.contact_id WHERE cv.id = $1`,
      [item.conversation_id],
    );
    if (!c) throw new GraphError("That conversation is gone.");
    const since = c.last_inbound_at ? Date.now() - Date.parse(c.last_inbound_at) : Infinity;
    // Past 24 hours only a person's reply may go, tagged HUMAN_AGENT, up to 7 days.
    const tagged = since > REPLY_WINDOW_MS && item.sent_by === "person" && since <= HUMAN_AGENT_WINDOW_MS && humanAgentOn(deps, account.platform);
    if (since > REPLY_WINDOW_MS && !tagged) {
      throw new GraphError(`${name} only allows replies within 24 hours of their last message.`);
    }
    const body = { recipient: { id: c.platform_user_id }, message: { text: item.text }, ...(tagged ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}) };
    const sent = await graph(deps, token, "me/messages", { method: "POST", body, platform });
    await recordOutgoing(deps, account, c.platform_user_id, c.username, item.text ?? "", item.sent_by, item.actor_id, undefined, sent.message_id ?? null);
    return;
  }

  const [comment] = await deps.sql<{ platform_comment_id: string; commenter_id: string | null; commenter_username: string | null; created_at: string; dm_sent_at: string | null }>(
    `SELECT platform_comment_id, commenter_id, commenter_username, created_at, dm_sent_at FROM public.inbox_comments WHERE id = $1`,
    [item.comment_id],
  );
  if (!comment) throw new GraphError("That comment is gone.");
  const id = encodeURIComponent(comment.platform_comment_id);

  if (item.kind === "comment_reply") {
    if (platform === "threads") await threadsReply(deps, token, account.external_account_id, comment.platform_comment_id, item.text ?? "");
    else await graph(deps, token, META[platform].reply(id), { method: "POST", body: { message: item.text }, platform });
    await deps.sql(`UPDATE public.inbox_comments SET replied_at = now() WHERE id = $1`, [item.comment_id]);
  } else if (item.kind === "private_reply") {
    if (comment.dm_sent_at) throw new GraphError(`This commenter already got a DM for this comment. ${name} allows one.`);
    if (Date.now() - Date.parse(comment.created_at) > PRIVATE_REPLY_WINDOW_MS) throw new GraphError(`${name} only allows a DM to a commenter within 7 days of the comment.`);
    const sent = await graph(deps, token, "me/messages", { method: "POST", body: { recipient: { comment_id: comment.platform_comment_id }, message: { text: item.text } }, platform });
    if (comment.commenter_id) {
      await recordOutgoing(deps, account, comment.commenter_id, comment.commenter_username, item.text ?? "", item.sent_by, item.actor_id, { commentId: comment.platform_comment_id }, sent.message_id ?? null);
    } else {
      await deps.sql(`UPDATE public.inbox_comments SET dm_sent_at = now() WHERE id = $1`, [item.comment_id]);
    }
  } else if (item.kind === "delete_comment") {
    if (platform === "threads") throw new GraphError("Threads doesn't let apps delete replies.");
    // Already gone there (deleted by its writer or in the app): it just leaves the inbox.
    await graph(deps, token, id, { method: "DELETE", platform }).catch((error) => {
      if (!(error instanceof GraphError && error.code === 100 && /does not exist/i.test(error.message))) throw error;
    });
    await deps.sql(`UPDATE public.inbox_comments SET deleted_at = now() WHERE id = $1`, [item.comment_id]);
  } else {
    const hide = item.kind === "hide_comment";
    await graph(deps, token, META[platform].hide(id, hide), { method: "POST", platform });
    await deps.sql(`UPDATE public.inbox_comments SET hidden = $2 WHERE id = $1`, [item.comment_id, hide]);
  }
}

// Sends what people queued. A refusal from the platform (window closed, comment deleted) fails
// the item with its reason; the person sees it in the inbox.
export async function runOutbox(deps: InboxDeps) {
  const items = await deps.sql<Outbox>(`SELECT * FROM public.claim_inbox_outbox(10, 120)`, []);
  let sent = 0;
  for (const item of items) {
    try {
      await sendOne(deps, item);
      await deps.sql(`UPDATE public.inbox_outbox SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1`, [item.id]);
      sent++;
    } catch (error) {
      deps.log?.("inbox send failed", { item: item.id, kind: item.kind, error: (error as Error).message });
      await deps.sql(`UPDATE public.inbox_outbox SET status = 'failed', error = $2 WHERE id = $1`, [item.id, (error as Error).message.slice(0, 300)]);
    }
  }
  return sent;
}
