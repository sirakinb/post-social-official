// Emails for new customers: five short emails from Aki, each sent at most once per person, ever,
// only to the workspace's owner, and never to anyone who unsubscribed.
//   welcome          once the email is confirmed, a plain note from Aki with the next step
//   no_account       two days after sign-up, nothing connected yet
//   no_ai            three days after sign-up, an account connected but no AI app or key
//   first_post_live  the first post that went live, with its link
//   week_one         a week after sign-up, to everyone: a plain note asking for a call
// The worker runs the sweep (worker/src/index.ts, off unless NUDGE_EMAILS is "on"); the api
// function records unsubscribes from the signed link at the bottom of each email.
import type { Sql } from "./access";

export type NudgeKind = "welcome" | "no_account" | "no_ai" | "first_post_live" | "week_one";
export type Due = { user_id: string; email: string; name: string | null; workspace_id: string; kind: NudgeKind; platform?: string | null; live_url?: string | null; connected?: boolean | null };
export type Email = { to: string; subject: string; text: string; html: string; unsubscribeUrl: string; user_id: string; kind: NudgeKind };

export const NUDGE_FROM = "Aki <aki@postsocial.xyz>";
// Aki's Cal.com page for a 30-minute call (Sundays, 12pm to midnight Eastern).
export const CALL_URL = "https://cal.com/akinyemi-bajulaiye-2jua88/post-social-call";
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

// The welcome and the week-one email read like a note from a person: plain paragraphs, no card,
// no button, signed "Aki". The other three use the designed card below.
type Note = { subject: string; paragraphs: string[] };

function note(due: Due, appUrl: string): Note | null {
  const hi = `Hi ${firstName(due.name)},`;
  if (due.kind === "welcome") {
    // Someone who connected an account before this went out is pointed at the AI step instead.
    const next = due.connected
      ? ["Your first account is already connected. The next step is connecting your AI, so you can post just by asking. It takes about a minute:", `${appUrl}/beta/api`]
      : ["The one thing to do first: connect a social account. It takes about a minute, and Post Social never sees your password.", `${appUrl}/beta/accounts`];
    return {
      subject: "Welcome to Post Social",
      paragraphs: [
        hi,
        "I'm Aki, and I built Post Social. Thanks for signing up.",
        "Post Social lets you post to TikTok, Instagram, YouTube, Facebook, Threads, LinkedIn, Bluesky and X by asking Claude, ChatGPT or any AI agent, or from the web composer.",
        next.join("\n"),
        "Your first two accounts are free.",
        "What are you hoping to post, and where? Just reply and tell me. I read every reply.",
      ],
    };
  }
  if (due.kind === "week_one") {
    return {
      subject: "One week with Post Social",
      paragraphs: [
        hi,
        "It's been a week since you signed up for Post Social, and I'd love to learn more about how you're planning to use it.",
        `Would you be open to a quick call? Book a time that works for you here: ${CALL_URL}`,
        "Or just reply to this email if that's easier.",
        "Looking forward to chatting,",
      ],
    };
  }
  return null;
}

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

// Images always load from the public site, whatever address the links use (dev links go to staging).
const ASSETS = "https://www.postsocial.xyz";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";
const linkify = (s: string, color = "#C9A8FF") => escape(s).replace(/(https:\/\/[^\s<]+?)(?=[.,]?(\s|$))/g, `<a href="$1" style="color:${color};text-decoration:none;">$1</a>`);

function noteHtml(n: Note, unsubscribe: string) {
  const p = (text: string) => `<p style="margin:0 0 16px;">${linkify(text, "#5B3FD6").replace(/\n/g, "<br>")}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(n.subject)}</title></head>
<body style="margin:0;padding:24px 16px;background:#FFFFFF;">
<div style="max-width:560px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1B1230;">
  ${n.paragraphs.map(p).join("")}
  <p style="margin:0;">Aki</p>
  <p style="margin:32px 0 0;font-size:12px;line-height:1.6;color:#7D7494;">You're getting this because you signed up for Post Social. <a href="${escape(unsubscribe)}" style="color:#7D7494;">Unsubscribe</a></p>
</div>
</body></html>`;
}

function html(c: Content, appUrl: string, unsubscribe: string) {
  const p = (text: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#CFC8DC;">${linkify(text)}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${escape(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#0B0816;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0B0816;">${escape(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0B0816;"><tr><td align="center" style="padding:28px 12px 40px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
  <tr><td style="padding:0 8px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle;"><img src="${ASSETS}/email/post-social-icon.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
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
  const n = note(due, appUrl);
  if (n) {
    const text = [...n.paragraphs, "Aki", "--", `You're getting this because you signed up for Post Social. Unsubscribe: ${unsubscribe}`].join("\n\n");
    return { to: due.email, subject: n.subject, text, html: noteHtml(n, unsubscribe), unsubscribeUrl: unsubscribe, user_id: due.user_id, kind: due.kind };
  }
  const c = content(due, appUrl);
  const text = [...c.intro, `${c.button.text}: ${c.button.url}`, ...c.after, "Aki\nPost Social", "--", `You're getting this because you signed up for Post Social. Unsubscribe: ${unsubscribe}`].join("\n\n");
  return { to: due.email, subject: c.subject, text, html: html(c, appUrl, unsubscribe), unsubscribeUrl: unsubscribe, user_id: due.user_id, kind: due.kind };
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
  const [welcome, noAccount, noAi, live, weekOne] = await Promise.all([
    // Only recent sign-ups, so people who joined long before this email existed never get it.
    sql<Due>(
      `SELECT m.user_id, u.email, a.display_name AS name, w.id AS workspace_id, 'welcome' AS kind,
         EXISTS (SELECT 1 FROM public.connected_accounts c WHERE c.workspace_id = w.id) AS connected ${OWNER}
       WHERE w.created_at > now() - interval '48 hours'
         ${NOT_SENT("welcome")}
       LIMIT $1`,
      [limit],
    ),
    sql<Due>(
      `SELECT m.user_id, u.email, a.display_name AS name, w.id AS workspace_id, 'no_account' AS kind ${OWNER}
       WHERE w.created_at < now() - interval '48 hours' AND w.created_at > now() - interval '7 days'
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
    // Everyone, whatever they've done, but never within a day of another email from us.
    sql<Due>(
      `SELECT m.user_id, u.email, a.display_name AS name, w.id AS workspace_id, 'week_one' AS kind ${OWNER}
       WHERE w.created_at < now() - interval '7 days' AND w.created_at > now() - interval '14 days'
         AND NOT EXISTS (SELECT 1 FROM public.email_nudges r WHERE r.user_id = m.user_id AND r.sent_at > now() - interval '24 hours')
         ${NOT_SENT("week_one")}
       LIMIT $1`,
      [limit],
    ),
  ]);
  return [...welcome, ...noAccount, ...noAi, ...live, ...weekOne];
}

// ---- the sweep ---------------------------------------------------------------------------------

export type NudgeDeps = {
  sql: Sql;
  // The id Resend gave the email ("" if it gave none), or null when the send failed.
  send: (email: Email) => Promise<string | null>;
  appUrl: string;
  secret: string;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

// Claims each email in email_nudges before sending it, so a restart or a second worker never
// sends it twice; a failed send gives the claim back for the next sweep.
export async function runNudgeSweep(deps: NudgeDeps): Promise<number> {
  let sent = 0;
  const emailed = new Set<string>();
  for (const due of await findDue(deps.sql)) {
    // The week-one note waits for the next day's sweeps if this sweep already emailed them.
    if (due.kind === "week_one" && emailed.has(due.user_id)) continue;
    // A claim the database refuses (say, a new kind before its migration ran) skips that one
    // email, never the rest of the sweep.
    const claimed = await deps.sql<{ user_id: string }>(
      `INSERT INTO public.email_nudges (user_id, kind, workspace_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id`,
      [due.user_id, due.kind, due.workspace_id],
    ).catch(() => {
      deps.log?.("nudge email not claimed", { kind: due.kind });
      return [];
    });
    if (!claimed.length) continue;
    const email = composeEmail(due, deps.appUrl, await unsubscribeUrl(deps.appUrl, deps.secret, due.user_id));
    const id = await deps.send(email).catch(() => null);
    if (id !== null) {
      sent++;
      emailed.add(due.user_id);
      // Kept so a delivery can be looked up in Resend exactly, not by subject and time.
      if (id) await deps.sql(`UPDATE public.email_nudges SET resend_id = $3 WHERE user_id = $1 AND kind = $2`, [due.user_id, due.kind, id]).catch(() => undefined);
    } else {
      await deps.sql(`DELETE FROM public.email_nudges WHERE user_id = $1 AND kind = $2`, [due.user_id, due.kind]);
      deps.log?.("nudge email failed", { kind: due.kind });
    }
  }
  return sent;
}

// Sends one email through Resend from Aki, replies to his inbox, blind-copying him, with the
// unsubscribe link in the List-Unsubscribe header, tagged with who it's for and which email it
// is. Gives back Resend's id for the email, or null if Resend didn't take it.
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
        tags: [
          { name: "type", value: "nudge" },
          { name: "kind", value: email.kind },
          { name: "user_id", value: email.user_id },
        ],
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as { id?: unknown };
    return typeof body.id === "string" ? body.id : "";
  };
}
