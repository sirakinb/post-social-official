// Closed-beta invites: a generated password plus the welcome email that carries it.
// Used by scripts/beta-invite.ts. The password lives only in the email; it is never printed
// or stored, except when the email fails to send (see the script).
import { randomInt } from "node:crypto";

export const BETA_FROM = "Aki <aki@postsocial.xyz>";
export const BETA_REPLY_TO = "aki.b@pentridgemedia.com";
export const BETA_SUBJECT = "You're in. Welcome to the Post Social beta";
export const PROD_SITE_URL = "https://www.postsocial.xyz";

// No look-alike characters (0/O, 1/l/I), so the password can be read off a phone screen.
const LETTERS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

export function generatePassword(length = 16, pick = (max: number) => randomInt(max)) {
  const all = LETTERS + DIGITS;
  const chars = Array.from({ length }, () => all[pick(all.length)]);
  // Sign-in requires a number; put one at a random position if the draw had none.
  if (!chars.some((c) => DIGITS.includes(c))) chars[pick(length)] = DIGITS[pick(DIGITS.length)];
  return chars.join("");
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type WelcomeFields = { firstName: string; email: string; password: string; siteUrl: string };

export function renderWelcomeEmail(template: string, fields: WelcomeFields, environment: "dev" | "prod") {
  const siteUrl = fields.siteUrl.replace(/\/+$/, "");
  const values: Record<string, string> = {
    first_name: escapeHtml(fields.firstName.trim()),
    email: escapeHtml(fields.email),
    password: escapeHtml(fields.password),
    site_url: escapeHtml(siteUrl),
  };
  const html = template
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      if (!(key in values)) throw new Error(`The welcome email template has an unknown field ${match}.`);
      return values[key];
    });
  const text = [
    `You're in, ${fields.firstName.trim()}.`,
    "",
    "Your account is ready. Tell your AI agent (Muse, Claude, ChatGPT, etc.) what to post, or do it yourself in the app, and it goes out to every channel on time.",
    "",
    `Email: ${fields.email}`,
    `Password: ${fields.password}`,
    `Sign in: ${siteUrl}/beta/login`,
    `Forgot your password? ${siteUrl}/beta/reset-password`,
    "",
    "Your first ten minutes",
    "1. Connect an account. TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky or X. Each one connects through the platform's own sign-in, so we never see your social passwords.",
    "2. Publish or schedule one post. Pick your channels, post now or choose a time, and watch it land on the calendar.",
    '3. Connect your AI. Add Post Social to Claude, ChatGPT or your agent of choice, then just ask: "Post today\'s clip to TikTok and Threads at 6pm."',
    "",
    "What beta means",
    "Everything works, and your posts go out for real. If something breaks or feels off, reply to this email.",
    "",
    "Glad you're here,",
    "Akinyemi",
    "Post Social",
    "",
    "You're getting this because you were invited to the Post Social beta.",
    "(c) 2026 Pentridge Media · postsocial.xyz",
  ].join("\n");
  const subject = environment === "dev" ? `[Dev] ${BETA_SUBJECT}` : BETA_SUBJECT;
  return { subject, html, text };
}

export type SendResult = { ok: true; id: string } | { ok: false; reason: string };

export async function sendWelcomeEmail(
  apiKey: string,
  to: string,
  email: { subject: string; html: string; text: string },
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from: BETA_FROM,
        to: [to],
        reply_to: [BETA_REPLY_TO],
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [{ name: "type", value: "beta_welcome" }],
      }),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok || !body?.id) return { ok: false, reason: `Resend answered ${response.status}: ${body?.message ?? "no details"}` };
    return { ok: true, id: body.id };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
