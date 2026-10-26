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

export const NUDGE_FROM = "Aki <aki@postsocial.xyz>";
// Replies reach Aki's inbox, as with the beta welcome email (scripts/lib/beta-invite.ts).
export const NUDGE_REPLY_TO = "aki.b@pentridgemedia.com";
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
// Same look as the beta welcome email (emails/closed-beta-welcome.html): the wordmark, one dark
// card, a peach label, a headline, short paragraphs, one button, signed by Aki.

const firstName = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "there";
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const isWebLink = (s: string | null | undefined): s is string => typeof s === "string" && /^https:\/\/[^\s"<>]+$/.test(s);

type Content = { subject: string; preheader: string; label: string; headline: string; intro: string[]; button: { text: string; url: string }; after: string[] };

function content(due: Due, appUrl: string): Content {
  const hi = `Hi ${firstName(due.name)},`;
  if (due.kind === "no_account") {
    return {
      subject: "Connect your first account to Post Social",
      preheader: "One step to your first post.",
      label: "Getting started",
      headline: "Connect your first account",
      intro: [hi, "You signed up for Post Social, but no social account is connected yet. That's the first step: pick Instagram, TikTok, YouTube or any of the others, and sign in on the platform's own page. Post Social never sees your password."],
      button: { text: "Connect an account", url: `${appUrl}/beta/accounts` },
      after: [`There's a one-minute walkthrough at ${appUrl}/docs/quickstart. If something gets in the way, just reply to this email.`],
    };
  }
  if (due.kind === "no_ai") {
    return {
      subject: "Post from Claude or ChatGPT in one step",
      preheader: "Post just by asking.",
      label: "Getting started",
      headline: "Connect your AI",
      intro: [hi, "Your account is connected. The next step is connecting your AI, so you can post just by asking: Claude, ChatGPT or any AI agent. It takes about a minute. Open API/MCP in Post Social, pick your AI and follow the steps."],
      button: { text: "Connect your AI", url: `${appUrl}/beta/api` },
      after: ["Reply to this email if you'd like a hand."],
    };
  }
  const where = PLATFORM_NAMES[due.platform ?? ""] ?? "your account";
  return {
    subject: "Your first post is live",
    preheader: `It went out on ${where}.`,
    label: "First post",
    headline: "Your first post is live",
    intro: [hi, `Your first post through Post Social just went live on ${where}.`],
    button: isWebLink(due.live_url) ? { text: "See your post", url: due.live_url } : { text: "Open your calendar", url: `${appUrl}/beta/calendar` },
    after: [`From here, you can ask your AI to schedule a week of posts in one message, and see them all on your calendar: ${appUrl}/beta/calendar`, "Thanks for trying Post Social. Reply anytime with ideas or problems."],
  };
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";
const linkify = (s: string) => escape(s).replace(/(https:\/\/[^\s<]+?)(?=[.,]?(\s|$))/g, '<a href="$1" style="color:#C9A8FF;text-decoration:none;">$1</a>');

function html(c: Content, appUrl: string, unsubscribe: string) {
  const p = (text: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#CFC8DC;">${linkify(text)}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${escape(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#0B0816;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0B0816;">${escape(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0B0816;"><tr><td align="center" style="padding:28px 12px 40px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
  <tr><td style="padding:0 8px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle;"><img src="${appUrl}/email/post-social-icon.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
    <td style="vertical-align:middle;padding-left:10px;font-family:Fraunces,Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:4px;text-transform:uppercase;color:#FAF6F0;">Post Social</td>
  </tr></table></td></tr>
  <tr><td style="background:#130E24;border:1px solid #2A2142;border-radius:18px;padding:32px 36px 30px;font-family:${FONT};">
    <p style="margin:0 0 14px;font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#FFC48A;">${escape(c.label)}</p>
    <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-0.5px;color:#FAF6F0;">${escape(c.headline)}</h1>
    ${c.intro.map(p).join("")}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;"><tr><td style="border-radius:999px;background:#FFD7B0;background-image:linear-gradient(180deg,#FFE3C4,#FFC48A);">
      <a href="${escape(c.button.url)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#1B1230;text-decoration:none;">${escape(c.button.text)}</a>
    </td></tr></table>
    ${c.after.map(p).join("")}
    <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#CFC8DC;"><span style="color:#FAF6F0;font-weight:600;">Aki</span><br><span style="color:#9C93B3;">Post Social</span></p>
  </td></tr>
  <tr><td style="padding:22px 12px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#7D7494;text-align:center;">
    You're getting this because you signed up for Post Social. <a href="${escape(unsubscribe)}" style="color:#9C93B3;">Unsubscribe</a><br>
    &copy; 2026 Pentridge Media &middot; <a href="${appUrl}" style="color:#9C93B3;text-decoration:none;">postsocial.xyz</a> &middot; <a href="${appUrl}/privacy" style="color:#9C93B3;text-decoration:none;">Privacy</a>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

export function composeEmail(due: Due, appUrl: string, unsubscribe: string): Email {
  const c = content(due, appUrl);
  const text = [...c.intro, `${c.button.text}: ${c.button.url}`, ...c.after, "Aki\nPost Social", "--", `You're getting this because you signed up for Post Social. Unsubscribe: ${unsubscribe}`].join("\n\n");
  return { to: due.email, subject: c.subject, text, html: html(c, appUrl, unsubscribe), unsubscribeUrl: unsubscribe };
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

// Sends one email through Resend from Aki, replies to his inbox, blind-copying him, with the
// unsubscribe link in the List-Unsubscribe header.
export function resendSender(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return async (email: Email) => {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: NUDGE_FROM,
        to: [email.to],
        bcc: [NUDGE_COPY_TO],
        reply_to: NUDGE_REPLY_TO,
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
