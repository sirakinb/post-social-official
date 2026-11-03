// Comment-to-DM (backend/lib/inbox): subscribes Instagram accounts and Facebook Pages to Meta's webhooks, then
// answers each stored comment event: picks the automation, sends the DM (Meta's "private
// reply", one per comment, within 7 days) with tracked link buttons, posts the optional
// public reply, and logs what happened. A comment is answered at most once per automation,
// even when an event is retried.
import type { Sql } from "../../../backend/lib/access";
import type { Settings } from "../../../backend/lib/connections/platforms";
import { inboxSwitch } from "../../../backend/lib/inbox/automations";
import { personalize, pickAutomation, pickVariation, type AutomationRule } from "../../../backend/lib/inbox/match";
import { accountToken } from "../credentials";
import { recordComment, recordMessage, recordOutgoing, type MessagingEvent } from "./inbox";

export type InboxPlatform = "instagram" | "facebook" | "threads";
export const PLATFORM_NAME: Record<InboxPlatform, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

// Where each platform's Graph API lives and how its calls differ. Facebook Pages use the Page
// token on graph.facebook.com; Instagram (Instagram Login) uses graph.instagram.com. Threads
// has no DMs; its replies are posted (container, then publish) and hidden with manage_reply.
export const META: Record<InboxPlatform, { host: string; fields: string[]; reply: (id: string) => string; hide: (id: string, hide: boolean) => string; profile: string }> = {
  instagram: {
    host: "https://graph.instagram.com/v25.0",
    fields: ["comments", "messages"],
    reply: (id) => `${id}/replies`,
    hide: (id, hide) => `${id}?hide=${hide}`,
    profile: "name,username",
  },
  facebook: {
    host: "https://graph.facebook.com/v25.0",
    fields: ["feed", "messages"],
    reply: (id) => `${id}/comments`,
    hide: (id, hide) => `${id}?is_hidden=${hide}`,
    profile: "name",
  },
  threads: {
    host: "https://graph.threads.net/v1.0",
    fields: ["replies"],
    reply: (id) => id, // see threadsReply
    hide: (id, hide) => `${id}/manage_reply?hide=${hide}`,
    profile: "",
  },
};

export type InboxDeps = {
  sql: Sql;
  setting: Settings;
  linkBase: string; // where tracked links point, e.g. https://www.postsocial.xyz
  http?: typeof fetch;
  token?: (accountId: string) => Promise<string>; // tests; otherwise the account's saved access
  random?: () => number;
  wait?: (ms: number) => Promise<void>; // tests
  log?: (message: string, details?: Record<string, unknown>) => void;
};

export type Account = { id: string; workspace_id: string; platform: InboxPlatform; display_name: string; external_account_id: string; webhook_id: string | null; handle?: string | null };

// Whether a comment came from the account itself (our own replies never trigger anything).
// Threads replies carry only a username.
export const fromAccount = (account: Account, from?: { id?: string; username?: string }) =>
  Boolean(from?.id && (from.id === account.webhook_id || from.id === account.external_account_id)) ||
  Boolean(account.platform === "threads" && from?.username && account.handle && from.username.toLowerCase() === account.handle.toLowerCase());
type Rule = AutomationRule & {
  workspace_id: string;
  connected_account_id: string;
  dm_message: string;
  dm_variations: string[];
  dm_buttons: Array<{ label: string; url: string }>;
  comment_reply: string | null;
  comment_reply_variations: string[];
  repeat_mode: "once" | "every_comment";
};
export type CommentValue = { id?: string; text?: string; from?: { id?: string; username?: string; name?: string }; media?: { id?: string }; parent_id?: string };

// A Facebook Page "feed" change, as a comment like Instagram's (only newly added comments).
export function facebookComment(value: Record<string, any>): CommentValue | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (value?.item !== "comment" || value?.verb !== "add" || !value.comment_id) return null;
  const parent = value.parent_id && value.parent_id !== value.post_id ? String(value.parent_id) : undefined;
  return {
    id: String(value.comment_id),
    text: typeof value.message === "string" ? value.message : "",
    from: value.from?.id ? { id: String(value.from.id), name: typeof value.from.name === "string" ? value.from.name : undefined } : undefined,
    media: value.post_id ? { id: String(value.post_id) } : undefined,
    parent_id: parent,
  };
}

// A Threads "replies" webhook value, as a comment. The person is known by username only.
export function threadsComment(value: Record<string, any>): CommentValue | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!value?.id) return null;
  const root = value.root_post?.id ? String(value.root_post.id) : undefined;
  const parent = value.replied_to?.id && String(value.replied_to.id) !== root ? String(value.replied_to.id) : undefined;
  const username = typeof value.username === "string" ? value.username : undefined;
  return {
    id: String(value.id),
    text: typeof value.text === "string" ? value.text : "",
    from: username ? { id: username, username } : undefined,
    media: root ? { id: root } : undefined,
    parent_id: parent,
  };
}

// A public reply on Threads: a text container replying to the post, then published (Threads
// may need a moment before the container can be published).
export async function threadsReply(deps: InboxDeps, token: string, replyTo: string, text: string) {
  const container = await graph(deps, token, `me/threads?media_type=TEXT&reply_to_id=${encodeURIComponent(replyTo)}&text=${encodeURIComponent(text)}`, { method: "POST", platform: "threads" });
  for (let attempt = 0; ; attempt++) {
    try {
      return await graph(deps, token, `me/threads_publish?creation_id=${encodeURIComponent(String(container.id))}`, { method: "POST", platform: "threads" });
    } catch (error) {
      if (attempt >= 2) throw error;
      await (deps.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(3000);
    }
  }
}
type StoredEvent = { id: number; platform: string; entry_id: string; field: string; payload: CommentValue };

export class GraphError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

export async function graph(deps: InboxDeps, token: string, path: string, init: { method?: string; body?: unknown; platform?: InboxPlatform } = {}) {
  const http = deps.http ?? fetch;
  const platform = init.platform ?? "instagram";
  const response = await http(`${META[platform].host}/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!response.ok || body.error) throw new GraphError(String(body.error?.message ?? `${PLATFORM_NAME[platform]} answered ${response.status}`).slice(0, 300), body.error?.code);
  return body;
}

export const tokenFor = (deps: InboxDeps, account: { id: string; display_name: string; platform?: InboxPlatform }) =>
  deps.token ? deps.token(account.id) : accountToken(deps, { id: account.id, platform: account.platform ?? "instagram", displayName: account.display_name });

// Learns each new account's webhook id and subscribes it to comment and message events. A
// Page's webhook id is the Page id; an Instagram account's is its professional user_id.
export async function subscribeAccounts(deps: InboxDeps) {
  // Every account in an inbox workspace is subscribed, with or without an automation, so its
  // DMs and comments reach the inbox.
  const on = inboxSwitch((name) => deps.setting(name));
  if (on.all || on.workspaces.length) {
    await deps.sql(
      `INSERT INTO public.inbox_accounts (connected_account_id, workspace_id)
       SELECT a.id, a.workspace_id FROM public.connected_accounts a
       WHERE a.platform IN ('instagram', 'facebook', 'threads') AND a.health <> 'disconnected' AND ($1 OR a.workspace_id::text = ANY($2::text[]))
       ON CONFLICT (connected_account_id) DO NOTHING`,
      [on.all, on.workspaces],
    );
  }
  const due = await deps.sql<Account>(
    `SELECT a.id, a.workspace_id, a.platform, a.display_name, a.external_account_id, ia.webhook_id
     FROM public.inbox_accounts ia JOIN public.connected_accounts a ON a.id = ia.connected_account_id
     WHERE ia.subscribed_at IS NULL AND ia.next_attempt_at <= now() AND a.health <> 'disconnected' AND a.platform IN ('instagram', 'facebook', 'threads')
     ORDER BY ia.next_attempt_at LIMIT 10`,
    [],
  );
  let done = 0;
  for (const account of due) {
    try {
      const token = await tokenFor(deps, account);
      const { fields } = META[account.platform];
      let webhookId = account.external_account_id;
      if (account.platform === "threads") {
        // Threads webhooks are subscribed once for the whole app, in Meta's dashboard.
      } else if (account.platform === "instagram") {
        const me = await graph(deps, token, "me?fields=user_id,username");
        webhookId = String(me.user_id ?? account.external_account_id);
        await graph(deps, token, `me/subscribed_apps?subscribed_fields=${fields.join(",")}`, { method: "POST" });
      } else {
        await graph(deps, token, `${encodeURIComponent(webhookId)}/subscribed_apps?subscribed_fields=${fields.join(",")}`, { method: "POST", platform: "facebook" });
      }
      await deps.sql(
        `UPDATE public.inbox_accounts SET webhook_id = $2, subscribed_fields = $3, subscribed_at = now(), last_error = NULL WHERE connected_account_id = $1`,
        [account.id, webhookId, fields],
      );
      done++;
    } catch (error) {
      deps.log?.("inbox subscribe failed", { account: account.id, error: (error as Error).message });
      await deps.sql(
        `UPDATE public.inbox_accounts SET last_error = $2, next_attempt_at = now() + interval '30 minutes' WHERE connected_account_id = $1`,
        [account.id, (error as Error).message.slice(0, 300)],
      );
    }
  }
  return done;
}

// Link codes come from crypto randomness so they can't be guessed; bytes past 228 are skipped to keep letters even.
const randomCode = () => {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let code = "";
  while (code.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 228 && code.length < 10) code += letters[b % letters.length];
    }
  }
  return code;
};

// The DM: plain text, or Meta's button card with each link wrapped so clicks count.
async function buildMessage(deps: InboxDeps, rule: Rule, runId: string, text: string) {
  if (!rule.dm_buttons.length) return { text };
  const buttons = [];
  for (const button of rule.dm_buttons) {
    const code = randomCode();
    await deps.sql(
      `INSERT INTO public.tracked_links (code, workspace_id, automation_id, run_id, url) VALUES ($1, $2, $3, $4, $5)`,
      [code, rule.workspace_id, rule.id, runId, button.url],
    );
    buttons.push({ type: "web_url", url: `${deps.linkBase.replace(/\/+$/, "")}/l/${code}`, title: button.label });
  }
  return { attachment: { type: "template", payload: { template_type: "button", text, buttons } } };
}

export async function accountFor(deps: InboxDeps, entryId: string, platform: InboxPlatform = "instagram") {
  const [account] = await deps.sql<Account>(
    `SELECT a.id, a.workspace_id, a.platform, a.display_name, a.external_account_id, a.handle, ia.webhook_id
     FROM public.connected_accounts a LEFT JOIN public.inbox_accounts ia ON ia.connected_account_id = a.id
     WHERE a.platform = $2 AND a.health <> 'disconnected' AND (ia.webhook_id = $1 OR a.external_account_id = $1)
     LIMIT 1`,
    [entryId, platform],
  );
  return account ?? null;
}

// One comment: finds the automation, claims the comment (so a retry can't send twice), then
// sends the DM and the public reply and records the outcome.
export async function answerComment(deps: InboxDeps, entryId: string, comment: CommentValue, platform: InboxPlatform = "instagram"): Promise<string> {
  const commentId = comment.id;
  const commenterId = comment.from?.id ?? null;
  if (!commentId) return "no comment id";
  const account = await accountFor(deps, entryId, platform);
  if (!account) return "no account";
  // The account's own comments (including our public replies) never trigger anything.
  if (fromAccount(account, comment.from)) return "own comment";
  const rules = await deps.sql<Rule>(
    `SELECT id, workspace_id, connected_account_id, platform_post_id, keywords, match_mode, exclude_keywords, created_at,
            dm_message, dm_variations, dm_buttons, comment_reply, comment_reply_variations, repeat_mode
     FROM public.comment_automations WHERE connected_account_id = $1 AND is_active`,
    [account.id],
  );
  const rule = pickAutomation(rules.map((r) => ({ ...r, created_at: String(r.created_at) })), { text: comment.text ?? "", postId: comment.media?.id ?? null });
  if (!rule) return "no match";

  const already = rule.repeat_mode === "once" && commenterId
    ? (await deps.sql<{ n: number }>(`SELECT count(*)::int AS n FROM public.automation_runs WHERE automation_id = $1 AND commenter_id = $2 AND status = 'sent'`, [rule.id, commenterId]))[0]?.n
    : 0;
  const [run] = await deps.sql<{ id: string }>(
    `INSERT INTO public.automation_runs (workspace_id, automation_id, connected_account_id, platform_comment_id, platform_post_id, commenter_id, commenter_username, comment_text, status, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'skipped', $9)
     ON CONFLICT (automation_id, platform_comment_id) DO NOTHING RETURNING id`,
    [rule.workspace_id, rule.id, account.id, commentId, comment.media?.id ?? null, commenterId, comment.from?.username ?? null, (comment.text ?? "").slice(0, 2000),
      already ? "Already sent this person the DM" : "Sending"],
  );
  if (!run) return "already handled";
  if (already) return "skipped";

  const random = deps.random ?? Math.random;
  const username = comment.from?.username ?? null;
  const name = comment.from?.name ?? null;
  const dmText = personalize(pickVariation(rule.dm_message, rule.dm_variations, random), username, name);
  let status: "sent" | "failed" = "sent";
  let reason: string | null = null;
  let replyStatus: "sent" | "failed" | "none" = "none";
  if (platform === "threads") return answerOnThreads(deps, account, rule, run.id, commentId, username, random);
  try {
    const token = await tokenFor(deps, account);
    const message = await buildMessage(deps, rule, run.id, dmText);
    await graph(deps, token, "me/messages", { method: "POST", body: { recipient: { comment_id: commentId }, message }, platform });
    if (rule.comment_reply) {
      try {
        const reply = personalize(pickVariation(rule.comment_reply, rule.comment_reply_variations, random), username, name);
        await graph(deps, token, META[platform].reply(encodeURIComponent(commentId)), { method: "POST", body: { message: reply }, platform });
        replyStatus = "sent";
      } catch (error) {
        replyStatus = "failed";
        deps.log?.("inbox public reply failed", { automation: rule.id, error: (error as Error).message });
      }
    }
  } catch (error) {
    status = "failed";
    reason = (error as Error).message.slice(0, 300);
  }
  await deps.sql(
    `UPDATE public.automation_runs SET status = $2, reason = $3, dm_text = $4, reply_status = $5 WHERE id = $1`,
    [run.id, status, reason, dmText, replyStatus],
  );
  if (status === "sent" && commenterId) await recordOutgoing(deps, account, commenterId, username, dmText, "automation", null, { commentId, replied: replyStatus === "sent" }, null, name);
  return status;
}

// Threads has no DMs: the automation answers with its public reply only.
async function answerOnThreads(deps: InboxDeps, account: Account, rule: Rule, runId: string, commentId: string, username: string | null, random: () => number) {
  let status: "sent" | "failed" = "sent";
  let reason: string | null = null;
  try {
    const reply = personalize(pickVariation(rule.comment_reply ?? "", rule.comment_reply_variations, random), username);
    if (!reply) throw new GraphError("This automation has no public reply.");
    await threadsReply(deps, await tokenFor(deps, account), commentId, reply);
    await deps.sql(`UPDATE public.inbox_comments SET replied_at = coalesce(replied_at, now()) WHERE connected_account_id = $1 AND platform_comment_id = $2`, [account.id, commentId]);
  } catch (error) {
    status = "failed";
    reason = (error as Error).message.slice(0, 300);
  }
  await deps.sql(
    `UPDATE public.automation_runs SET status = $2, reason = $3, dm_text = $4, reply_status = $5 WHERE id = $1`,
    [runId, status, reason, null, status],
  );
  return status;
}

// Handles stored webhook events. Comments are answered; other events are kept for the inbox.
export async function runInboxSweep(deps: InboxDeps) {
  const events = await deps.sql<StoredEvent>(`SELECT * FROM public.claim_inbox_events(20, 120)`, []);
  let handled = 0;
  for (const event of events) {
    try {
      const platform: InboxPlatform = event.platform === "facebook" ? "facebook" : event.platform === "threads" ? "threads" : "instagram";
      const comment = platform === "instagram" && event.field === "comments" ? event.payload
        : platform === "facebook" && event.field === "feed" ? facebookComment(event.payload as Record<string, unknown>)
        : platform === "threads" && event.field === "replies" ? threadsComment(event.payload as Record<string, unknown>) : null;
      if (comment) {
        await recordComment(deps, event.entry_id, comment, platform);
        await answerComment(deps, event.entry_id, comment, platform);
      }
      if (event.field === "messages" && platform !== "threads") await recordMessage(deps, event.entry_id, event.payload as MessagingEvent, platform);
      await deps.sql(`UPDATE public.inbox_webhook_events SET processed_at = now(), error = NULL WHERE id = $1`, [event.id]);
      handled++;
    } catch (error) {
      deps.log?.("inbox event failed", { event: event.id, error: (error as Error).message });
      await deps.sql(`UPDATE public.inbox_webhook_events SET error = $2, lease_until = now() + interval '1 minute' WHERE id = $1`, [event.id, (error as Error).message.slice(0, 300)]);
    }
  }
  return handled;
}
