// LinkedIn Company Page comments in the inbox (Community Management API). LinkedIn sends
// no webhooks to this app, so comments on the Page's posts made through Post Social are read
// every few minutes. LinkedIn's data storage rules decide what is kept:
// - a member's comment text: at most 48 hours, so comments older than that are never read
//   and are removed from the inbox once they pass it;
// - a commenter's profile (name, photo): not stored at all; the inbox says "LinkedIn member";
// - ids (the comment's and the commenter's member URN): no limit.
// Replies are posted and comments deleted as the Page.
import type { Sql } from "../../../backend/lib/access";
import { LINKEDIN_API, LINKEDIN_VERSION, isLinkedInPage, linkedinAuthor } from "../../../backend/lib/connections/linkedin";
import { inboxSwitch } from "../../../backend/lib/inbox/automations";
import { accountToken } from "../credentials";
import type { InboxDeps } from "./runner";

export const LINKEDIN_KEEP_HOURS = 48;
const KEEP_MS = LINKEDIN_KEEP_HOURS * 3600_000;
// Posts read per Page per sweep: the newest published through Post Social in the last 30 days.
const POSTS_PER_PAGE = 10;

export class LinkedInInboxError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const tokenOf = (deps: InboxDeps, account: { id: string; display_name: string }) =>
  deps.token ? deps.token(account.id) : accountToken(deps, { id: account.id, platform: "linkedin", displayName: account.display_name });

type PageAccount = { id: string; workspace_id: string; platform: "linkedin"; display_name: string; external_account_id: string };
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// restli: false for addresses with a comment's id in them (urn:li:comment:(…,…)): with the
// Rest.li 2.0 header LinkedIn refuses them as a "syntax exception in path variables".
async function linkedin(deps: InboxDeps, token: string, path: string, init: { method?: string; body?: unknown; restli?: boolean } = {}): Promise<{ body: Json; headers: Headers }> {
  const response = await (deps.http ?? fetch)(`${LINKEDIN_API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "LinkedIn-Version": LINKEDIN_VERSION,
      ...(init.restli === false ? {} : { "X-Restli-Protocol-Version": "2.0.0" }),
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let body: Json = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep empty
  }
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : `LinkedIn answered ${response.status}`;
    throw new LinkedInInboxError(message.slice(0, 300), response.status);
  }
  return { body, headers: response.headers };
}

// "urn:li:comment:(urn:li:activity:1,22)" -> "22"
export const commentIdOf = (commentUrn: string) => /,(\d+)\)$/.exec(commentUrn)?.[1] ?? null;

// Page accounts in inbox workspaces that may read their posts' comments.
async function pageAccounts(deps: InboxDeps): Promise<PageAccount[]> {
  const on = inboxSwitch((name) => deps.setting(name));
  if (!on.all && !on.workspaces.length) return [];
  return deps.sql<PageAccount>(
    `SELECT a.id, a.workspace_id, a.platform, a.display_name, a.external_account_id FROM public.connected_accounts a
     WHERE a.platform = 'linkedin' AND a.external_account_id LIKE 'organization:%' AND a.health <> 'disconnected'
       AND 'r_organization_social_feed' = ANY(a.scopes) AND ($1 OR a.workspace_id::text = ANY($2::text[]))
     ORDER BY a.created_at LIMIT 25`,
    [on.all, on.workspaces],
  );
}

// Reads comments from the last 48 hours on each Page's recent posts into the inbox.
export async function catchUpLinkedInComments(deps: InboxDeps, now = Date.now) {
  let found = 0;
  for (const account of await pageAccounts(deps)) {
    try {
      const token = await tokenOf(deps, account);
      const page = linkedinAuthor(account.external_account_id);
      const posts = await deps.sql<{ platform_request_id: string }>(
        `SELECT platform_request_id FROM public.destinations
         WHERE connected_account_id = $1 AND status = 'published' AND platform_request_id LIKE 'urn:li:%'
           AND updated_at > now() - interval '30 days'
         ORDER BY updated_at DESC LIMIT ${POSTS_PER_PAGE}`,
        [account.id],
      );
      for (const { platform_request_id: post } of posts) {
        const { body } = await linkedin(deps, token, `/socialActions/${encodeURIComponent(post)}/comments?count=50`);
        for (const comment of Array.isArray(body.elements) ? (body.elements as Json[]) : []) {
          const urn = typeof comment.commentUrn === "string" ? comment.commentUrn : null;
          const at = Number(comment.created?.time);
          if (!urn || !Number.isFinite(at) || now() - at > KEEP_MS) continue;
          const actor = typeof comment.actor === "string" ? comment.actor : null;
          const own = actor === page;
          await deps.sql(
            `INSERT INTO public.inbox_comments (workspace_id, connected_account_id, platform_comment_id, platform_post_id, parent_comment_id, commenter_id, commenter_username, text, from_account, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)
             ON CONFLICT (connected_account_id, platform_comment_id) DO UPDATE SET text = EXCLUDED.text
               WHERE inbox_comments.text IS DISTINCT FROM EXCLUDED.text`,
            [account.workspace_id, account.id, urn, post, typeof comment.parentComment === "string" ? comment.parentComment : null, actor,
              String(comment.message?.text ?? "").slice(0, 2200), own, new Date(at).toISOString()],
          );
          found++;
        }
      }
    } catch (error) {
      deps.log?.("linkedin comments catch-up failed", { account: account.id, error: (error as Error).message });
    }
  }
  return found;
}

// LinkedIn comments leave the inbox once they are 48 hours old (with anything queued for them).
export async function purgeLinkedInComments(sql: Sql) {
  const removed = await sql<{ id: string }>(
    `DELETE FROM public.inbox_comments c USING public.connected_accounts a
     WHERE a.id = c.connected_account_id AND a.platform = 'linkedin' AND c.created_at < now() - interval '${LINKEDIN_KEEP_HOURS} hours'
     RETURNING c.id`,
    [],
  );
  return removed.length;
}

type QueuedForComment = { kind: string; comment_id: string | null; text: string | null };
type StoredComment = { platform_comment_id: string; platform_post_id: string | null; workspace_id: string };

// A reply or a delete queued in Post Social, sent as the Page.
export async function sendLinkedIn(deps: InboxDeps, account: { id: string; external_account_id: string; display_name: string }, item: QueuedForComment) {
  if (!isLinkedInPage(account.external_account_id)) throw new LinkedInInboxError("Only LinkedIn Company Pages have an inbox.");
  if (item.kind === "message" || item.kind === "private_reply") throw new LinkedInInboxError("LinkedIn doesn't let apps send DMs from a Page. Reply publicly instead.");
  if (item.kind === "hide_comment" || item.kind === "unhide_comment") throw new LinkedInInboxError("LinkedIn doesn't let apps hide comments. Delete it instead.");
  const [comment] = await deps.sql<StoredComment>(
    `SELECT platform_comment_id, platform_post_id, workspace_id FROM public.inbox_comments WHERE id = $1`,
    [item.comment_id],
  );
  if (!comment?.platform_post_id) throw new LinkedInInboxError("That comment is gone.");
  const token = await tokenOf(deps, account);
  const page = linkedinAuthor(account.external_account_id);

  if (item.kind === "comment_reply") {
    const { body, headers } = await linkedin(deps, token, `/socialActions/${encodeURIComponent(comment.platform_comment_id)}/comments`, {
      method: "POST",
      body: { actor: page, object: comment.platform_post_id, parentComment: comment.platform_comment_id, message: { text: item.text ?? "" } },
      restli: false,
    });
    const urn = typeof body.commentUrn === "string" ? body.commentUrn : null;
    const id = headers.get("x-restli-id");
    // The Page's own reply: kept so it shows under the comment (an organization's activity).
    await deps.sql(
      `INSERT INTO public.inbox_comments (workspace_id, connected_account_id, platform_comment_id, platform_post_id, parent_comment_id, commenter_id, text, from_account)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) ON CONFLICT (connected_account_id, platform_comment_id) DO NOTHING`,
      [comment.workspace_id, account.id, urn ?? `reply:${id ?? crypto.randomUUID()}`, comment.platform_post_id, comment.platform_comment_id, page, (item.text ?? "").slice(0, 2200)],
    );
    await deps.sql(`UPDATE public.inbox_comments SET replied_at = now() WHERE id = $1`, [item.comment_id]);
    return;
  }

  if (item.kind === "delete_comment") {
    const id = commentIdOf(comment.platform_comment_id);
    if (!id) throw new LinkedInInboxError("That comment can't be deleted from here.");
    await linkedin(deps, token, `/socialActions/${encodeURIComponent(comment.platform_post_id)}/comments/${id}?actor=${encodeURIComponent(page)}`, { method: "DELETE" }).catch((error) => {
      // Already gone on LinkedIn: it just leaves the inbox.
      if (!(error instanceof LinkedInInboxError && error.status === 404)) throw error;
    });
    await deps.sql(`UPDATE public.inbox_comments SET deleted_at = now() WHERE id = $1`, [item.comment_id]);
    return;
  }
  throw new LinkedInInboxError("LinkedIn can't do that from the inbox.");
}
