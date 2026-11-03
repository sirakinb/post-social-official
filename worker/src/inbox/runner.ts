// Comment-to-DM (backend/lib/inbox): subscribes Instagram accounts to Meta's webhooks, then
// answers each stored comment event: picks the automation, sends the DM (Meta's "private
// reply", one per comment, within 7 days) with tracked link buttons, posts the optional
// public reply, and logs what happened. A comment is answered at most once per automation,
// even when an event is retried.
import type { Sql } from "../../../backend/lib/access";
import type { Settings } from "../../../backend/lib/connections/platforms";
import { personalize, pickAutomation, pickVariation, type AutomationRule } from "../../../backend/lib/inbox/match";
import { accountToken } from "../credentials";
import { recordComment, recordMessage, recordOutgoing, type MessagingEvent } from "./inbox";

const GRAPH = "https://graph.instagram.com/v25.0";
const FIELDS = ["comments", "messages"];

export type InboxDeps = {
  sql: Sql;
  setting: Settings;
  linkBase: string; // where tracked links point, e.g. https://www.postsocial.xyz
  http?: typeof fetch;
  token?: (accountId: string) => Promise<string>; // tests; otherwise the account's saved access
  random?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

export type Account = { id: string; workspace_id: string; platform: "instagram"; display_name: string; external_account_id: string; webhook_id: string | null };
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
export type CommentValue = { id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string } };
type StoredEvent = { id: number; platform: string; entry_id: string; field: string; payload: CommentValue };

export class GraphError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

export async function graph(deps: InboxDeps, token: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const http = deps.http ?? fetch;
  const response = await http(`${GRAPH}/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!response.ok || body.error) throw new GraphError(String(body.error?.message ?? `Instagram answered ${response.status}`).slice(0, 300), body.error?.code);
  return body;
}

export const tokenFor = (deps: InboxDeps, account: { id: string; display_name: string }) =>
  deps.token ? deps.token(account.id) : accountToken(deps, { id: account.id, platform: "instagram", displayName: account.display_name });

// Learns each new account's webhook id and subscribes it to comment and message events.
export async function subscribeAccounts(deps: InboxDeps) {
  const due = await deps.sql<Account>(
    `SELECT a.id, a.workspace_id, a.platform, a.display_name, a.external_account_id, ia.webhook_id
     FROM public.inbox_accounts ia JOIN public.connected_accounts a ON a.id = ia.connected_account_id
     WHERE ia.subscribed_at IS NULL AND ia.next_attempt_at <= now() AND a.health <> 'disconnected' AND a.platform = 'instagram'
     ORDER BY ia.next_attempt_at LIMIT 10`,
    [],
  );
  let done = 0;
  for (const account of due) {
    try {
      const token = await tokenFor(deps, account);
      const me = await graph(deps, token, "me?fields=user_id,username");
      const webhookId = String(me.user_id ?? account.external_account_id);
      await graph(deps, token, `me/subscribed_apps?subscribed_fields=${FIELDS.join(",")}`, { method: "POST" });
      await deps.sql(
        `UPDATE public.inbox_accounts SET webhook_id = $2, subscribed_fields = $3, subscribed_at = now(), last_error = NULL WHERE connected_account_id = $1`,
        [account.id, webhookId, FIELDS],
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

const randomCode = (random: () => number) => {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => letters[Math.floor(random() * letters.length)]).join("");
};

// The DM: plain text, or Instagram's button card with each link wrapped so clicks count.
async function buildMessage(deps: InboxDeps, rule: Rule, runId: string, text: string) {
  if (!rule.dm_buttons.length) return { text };
  const random = deps.random ?? Math.random;
  const buttons = [];
  for (const button of rule.dm_buttons) {
    const code = randomCode(random);
    await deps.sql(
      `INSERT INTO public.tracked_links (code, workspace_id, automation_id, run_id, url) VALUES ($1, $2, $3, $4, $5)`,
      [code, rule.workspace_id, rule.id, runId, button.url],
    );
    buttons.push({ type: "web_url", url: `${deps.linkBase.replace(/\/+$/, "")}/l/${code}`, title: button.label });
  }
  return { attachment: { type: "template", payload: { template_type: "button", text, buttons } } };
}

export async function accountFor(deps: InboxDeps, entryId: string) {
  const [account] = await deps.sql<Account>(
    `SELECT a.id, a.workspace_id, a.platform, a.display_name, a.external_account_id, ia.webhook_id
     FROM public.connected_accounts a LEFT JOIN public.inbox_accounts ia ON ia.connected_account_id = a.id
     WHERE a.platform = 'instagram' AND a.health <> 'disconnected' AND (ia.webhook_id = $1 OR a.external_account_id = $1)
     LIMIT 1`,
    [entryId],
  );
  return account ?? null;
}

// One comment: finds the automation, claims the comment (so a retry can't send twice), then
// sends the DM and the public reply and records the outcome.
export async function answerComment(deps: InboxDeps, entryId: string, comment: CommentValue): Promise<string> {
  const commentId = comment.id;
  const commenterId = comment.from?.id ?? null;
  if (!commentId) return "no comment id";
  const account = await accountFor(deps, entryId);
  if (!account) return "no account";
  // The account's own comments (including our public replies) never trigger anything.
  if (commenterId && (commenterId === account.webhook_id || commenterId === account.external_account_id)) return "own comment";
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
  const dmText = personalize(pickVariation(rule.dm_message, rule.dm_variations, random), username);
  let status: "sent" | "failed" = "sent";
  let reason: string | null = null;
  let replyStatus: "sent" | "failed" | "none" = "none";
  try {
    const token = await tokenFor(deps, account);
    const message = await buildMessage(deps, rule, run.id, dmText);
    await graph(deps, token, "me/messages", { method: "POST", body: { recipient: { comment_id: commentId }, message } });
    if (rule.comment_reply) {
      try {
        const reply = personalize(pickVariation(rule.comment_reply, rule.comment_reply_variations, random), username);
        await graph(deps, token, `${commentId}/replies`, { method: "POST", body: { message: reply } });
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
  if (status === "sent" && commenterId) await recordOutgoing(deps, account, commenterId, comment.from?.username ?? null, dmText, "automation", null, { commentId, replied: replyStatus === "sent" });
  return status;
}

// Handles stored webhook events. Comments are answered; other events are kept for the inbox.
export async function runInboxSweep(deps: InboxDeps) {
  const events = await deps.sql<StoredEvent>(`SELECT * FROM public.claim_inbox_events(20, 120)`, []);
  let handled = 0;
  for (const event of events) {
    try {
      if (event.platform === "instagram" && event.field === "comments") {
        await recordComment(deps, event.entry_id, event.payload);
        await answerComment(deps, event.entry_id, event.payload);
      }
      if (event.platform === "instagram" && event.field === "messages") await recordMessage(deps, event.entry_id, event.payload as MessagingEvent);
      await deps.sql(`UPDATE public.inbox_webhook_events SET processed_at = now(), error = NULL WHERE id = $1`, [event.id]);
      handled++;
    } catch (error) {
      deps.log?.("inbox event failed", { event: event.id, error: (error as Error).message });
      await deps.sql(`UPDATE public.inbox_webhook_events SET error = $2, lease_until = now() + interval '1 minute' WHERE id = $1`, [event.id, (error as Error).message.slice(0, 300)]);
    }
  }
  return handled;
}
