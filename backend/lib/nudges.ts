// Nudge emails for new customers: three short, plain emails from Aki, each sent at most once
// per person, ever, only to the workspace's owner, and never to anyone who unsubscribed.
//   no_account       a day after sign-up, nothing connected yet
//   no_ai            three days after sign-up, an account connected but no AI app or key
//   first_post_live  the first post that went live, with its link
// The worker runs the sweep (worker/src/index.ts, off unless NUDGE_EMAILS is "on"); the api
// function records unsubscribes from the signed link at the bottom of each email.
import type { Sql } from "./access";

export type NudgeKind = "no_account" | "no_ai" | "first_post_live";
export type Due = { user_id: string; email: string; name: string | null; workspace_id: string; kind: NudgeKind; platform?: string | null; live_url?: string | null };
export type Email = { to: string; subject: string; text: string; html: string; unsubscribeUrl: string };

export const NUDGE_FROM = "Akinyemi <akinyemi@postsocial.xyz>";
// AGENTS.md: real outbound emails to users always copy Aki. Blind, so customers don't see it.
export const NUDGE_COPY_TO = "aki.b@pentridgemedia.com";

const PLATFORM_NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn", bluesky: "Bluesky", x: "X" };

// ---- signed unsubscribe links --------------------------------------------------------------

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function linkToken(secret: string, userId: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsubscribe:${userId}`)));
}

export async function validLinkToken(secret: string, userId: string, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const expected = await linkToken(secret, userId);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function unsubscribeUrl(appUrl: string, secret: string, userId: string) {
  const url = new URL("/email/unsubscribe", appUrl);
  url.searchParams.set("u", userId);
  url.searchParams.set("t", await linkToken(secret, userId));
  return url.toString();
}

export async function optOut(sql: Sql, userId: string) {
  await sql(
    `INSERT INTO public.email_preferences (user_id, nudges_off_at) VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET nudges_off_at = COALESCE(public.email_preferences.nudges_off_at, now()), updated_at = now()`,
    [userId],
  );
}

// ---- the emails ------------------------------------------------------------------------------

const firstName = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "there";
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function body(kind: NudgeKind, due: Due, appUrl: string): { subject: string; paragraphs: string[] } {
  const hi = `Hi ${firstName(due.name)},`;
  if (kind === "no_account") {
    return {
      subject: "Connect your first account to Post Social",
      paragraphs: [
        hi,
        "You signed up for Post Social, but no social account is connected yet. That's the first step: open Accounts, pick Instagram, TikTok, YouTube or any of the others, and sign in on the platform's own page. Post Social never sees your password.",
        `Connect an account: ${appUrl}/beta/accounts`,
        `There's a one-minute walkthrough here: ${appUrl}/docs/quickstart`,
        "If something gets in the way, just reply to this email.",
      ],
    };
  }
  if (kind === "no_ai") {
    return {
      subject: "Post from Claude or ChatGPT in one step",
      paragraphs: [
        hi,
        "Your account is connected. The next step is connecting your AI, so you can post just by asking: Claude, ChatGPT or any AI agent. It takes about a minute. Open API/MCP in Post Social, pick your AI, and follow the steps.",
        `Connect your AI: ${appUrl}/beta/api`,
        "Reply to this email if you'd like a hand.",
      ],
    };
  }
  const where = PLATFORM_NAMES[due.platform ?? ""] ?? "your account";
  return {
    subject: "Your first post is live",
    paragraphs: [
      hi,
      due.live_url ? `Your first post through Post Social just went live on ${where}: ${due.live_url}` : `Your first post through Post Social just went live on ${where}.`,
      `From here, you can ask your AI to schedule a week of posts in one message, and see them all on your calendar: ${appUrl}/beta/calendar`,
      "Thanks for trying Post Social. Reply anytime with ideas or problems.",
    ],
  };
}

export function composeEmail(due: Due, appUrl: string, unsubscribe: string): Email {
  const { subject, paragraphs } = body(due.kind, due, appUrl);
  const sign = ["Aki", "Founder, Post Social"];
  const footer = `You're getting this because you signed up for Post Social. Don't want these emails? Unsubscribe: ${unsubscribe}`;
  const text = [...paragraphs, sign.join("\n"), "--", footer].join("\n\n");
  const link = (s: string) => escape(s).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1b1726;max-width:560px">${paragraphs.map((p) => `<p>${link(p)}</p>`).join("")}<p>${sign.map(escape).join("<br>")}</p><p style="font-size:12px;color:#6e6784;border-top:1px solid #e6e1ec;padding-top:12px">You're getting this because you signed up for Post Social. Don't want these emails? <a href="${escape(unsubscribe)}">Unsubscribe</a>.</p></div>`;
  return { to: due.email, subject, text, html, unsubscribeUrl: unsubscribe };
}

// ---- who is due --------------------------------------------------------------------------

// The workspace's owner who created it, with a confirmed email and nudges not switched off.
const OWNER = `
  FROM public.workspaces w
  JOIN public.workspace_members m ON m.workspace_id = w.id AND m.role = 'owner' AND m.user_id = w.created_by
  JOIN auth.users u ON u.id = m.user_id AND u.email_verified
  LEFT JOIN public.actors a ON a.workspace_id = w.id AND a.user_id = m.user_id AND a.kind = 'user'`;
const NOT_SENT = (kind: NudgeKind) => `
  AND NOT EXISTS (SELECT 1 FROM public.email_nudges n WHERE n.user_id = m.user_id AND n.kind = '${kind}')
  AND NOT EXISTS (SELECT 1 FROM public.email_preferences p WHERE p.user_id = m.user_id AND p.nudges_off_at IS NOT NULL)`;

export async function findDue(sql: Sql, limit = 50): Promise<Due[]> {
  const [noAccount, noAi, live] = await Promise.all([
    sql<Due>(
      `SELECT m.user_id, u.email, a.display_name AS name, w.id AS workspace_id, 'no_account' AS kind ${OWNER}
       WHERE w.created_at < now() - interval '24 hours' AND w.created_at > now() - interval '7 days'
         AND NOT EXISTS (SELECT 1 FROM public.connected_accounts c WHERE c.workspace_id = w.id)
         ${NOT_SENT("no_account")}
       LIMIT $1`,
      [limit],
    ),
    sql<Due>(
      `SELECT m.user_id, u.email, a.display_name AS name, w.id AS workspace_id, 'no_ai' AS kind ${OWNER}
       WHERE w.created_at < now() - interval '72 hours' AND w.created_at > now() - interval '14 days'
         AND EXISTS (SELECT 1 FROM public.connected_accounts c WHERE c.workspace_id = w.id)
         AND NOT EXISTS (SELECT 1 FROM public.oauth_grants g WHERE g.workspace_id = w.id AND g.revoked_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.api_keys k WHERE k.workspace_id = w.id AND k.revoked_at IS NULL)
         ${NOT_SENT("no_ai")}
       LIMIT $1`,
      [limit],
    ),
    sql<Due>(
      `SELECT m.user_id, u.email, a.display_name AS name, w.id AS workspace_id, 'first_post_live' AS kind, d.platform, d.live_url ${OWNER}
       JOIN LATERAL (
         SELECT d.platform, d.live_url, d.updated_at FROM public.destinations d
         WHERE d.workspace_id = w.id AND d.status = 'published' ORDER BY d.updated_at ASC LIMIT 1
       ) d ON true
       WHERE d.updated_at > now() - interval '48 hours' AND w.created_at > now() - interval '60 days'
         ${NOT_SENT("first_post_live")}
       LIMIT $1`,
      [limit],
    ),
  ]);
  return [...noAccount, ...noAi, ...live];
}

// ---- the sweep ---------------------------------------------------------------------------------

export type NudgeDeps = {
  sql: Sql;
  send: (email: Email) => Promise<boolean>;
  appUrl: string;
  secret: string;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

// Claims each email in email_nudges before sending it, so a restart or a second worker never
// sends it twice; a failed send gives the claim back for the next sweep.
export async function runNudgeSweep(deps: NudgeDeps): Promise<number> {
  let sent = 0;
  for (const due of await findDue(deps.sql)) {
    const claimed = await deps.sql<{ user_id: string }>(
      `INSERT INTO public.email_nudges (user_id, kind, workspace_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id`,
      [due.user_id, due.kind, due.workspace_id],
    );
    if (!claimed.length) continue;
    const email = composeEmail(due, deps.appUrl, await unsubscribeUrl(deps.appUrl, deps.secret, due.user_id));
    const ok = await deps.send(email).catch(() => false);
    if (ok) sent++;
    else {
      await deps.sql(`DELETE FROM public.email_nudges WHERE user_id = $1 AND kind = $2`, [due.user_id, due.kind]);
      deps.log?.("nudge email failed", { kind: due.kind });
    }
  }
  return sent;
}

// Sends one email through Resend, blind-copying Aki, with a one-click unsubscribe header.
export function resendSender(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return async (email: Email) => {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: NUDGE_FROM,
        to: [email.to],
        bcc: [NUDGE_COPY_TO],
        reply_to: NUDGE_FROM,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: { "List-Unsubscribe": `<${email.unsubscribeUrl}>` },
        tags: [{ name: "type", value: "nudge" }],
      }),
    });
    return response.ok;
  };
}
