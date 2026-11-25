// The two emails our sign-in sends: a code to confirm an email address, and a code to reset
// a password. Sent through Resend from postsocial.xyz, in the same look as our other emails.
//
// A code is a secret, so these go to the person only: never copied to anyone, never logged.
export type CodeKind = "confirm-email" | "reset-password";
export type CodeEmail = { to: string; subject: string; text: string; html: string; kind: CodeKind };

export const SIGN_IN_FROM = "Post Social <hello@postsocial.xyz>";
// How long a code works, in minutes. The emails say so, and backend/lib/auth/auth.ts enforces it.
export const CODE_MINUTES = 10;

const ASSETS = "https://www.postsocial.xyz";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const COPY: Record<CodeKind, { subject: (code: string) => string; label: string; headline: string; intro: string; after: string }> = {
  "confirm-email": {
    subject: (code) => `${code} is your Post Social code`,
    label: "Confirm your email",
    headline: "Here's your code",
    intro: "Enter this code in Post Social to confirm your email address.",
    after: "If you didn't sign up for Post Social, you can ignore this email.",
  },
  "reset-password": {
    subject: (code) => `${code} is your Post Social password reset code`,
    label: "Reset your password",
    headline: "Here's your code",
    intro: "Enter this code in Post Social to choose a new password.",
    after: "If you didn't ask to reset your password, you can ignore this email. Your password stays as it is.",
  },
};

export function composeCodeEmail(kind: CodeKind, to: string, code: string): CodeEmail {
  if (!/^\d{4,8}$/.test(code)) throw new Error("Not a sign-in code.");
  const c = COPY[kind];
  const lasts = `The code works for ${CODE_MINUTES} minutes.`;
  const text = [c.intro, code, lasts, c.after, "Post Social"].join("\n\n");
  const p = (line: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#CFC8DC;">${escape(line)}</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${escape(c.label)}</title></head>
<body style="margin:0;padding:0;background:#0B0816;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0B0816;">${escape(c.intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0B0816;"><tr><td align="center" style="padding:28px 12px 40px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
  <tr><td style="padding:0 8px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle;"><img src="${ASSETS}/email/post-social-icon.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
    <td style="vertical-align:middle;padding-left:10px;font-family:Fraunces,Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:4px;text-transform:uppercase;color:#FAF6F0;">Post Social</td>
  </tr></table></td></tr>
  <tr><td style="background:#130E24;border:1px solid #2A2142;border-radius:18px;padding:32px 36px 30px;font-family:${FONT};">
    <p style="margin:0 0 14px;font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#FFC48A;">${escape(c.label)}</p>
    <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-0.5px;color:#FAF6F0;">${escape(c.headline)}</h1>
    ${p(c.intro)}
    <p style="margin:6px 0 22px;font-family:${MONO};font-size:34px;line-height:1.2;font-weight:600;letter-spacing:8px;color:#FFD7B0;">${escape(code)}</p>
    ${p(lasts)}
    <p style="margin:0;font-size:14px;line-height:1.6;color:#9C93B3;">${escape(c.after)}</p>
  </td></tr>
  <tr><td style="padding:22px 12px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#7D7494;text-align:center;">
    &copy; 2026 Pentridge Media &middot; <a href="${ASSETS}" style="color:#9C93B3;text-decoration:none;">postsocial.xyz</a>
  </td></tr>
</table></td></tr></table>
</body></html>`;
  return { to, subject: c.subject(code), text, html, kind };
}

// Sends through Resend. Throws when Resend says no, so the caller can report it; the
// message never carries the code or the address.
export function resendCodeSender(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return async (email: CodeEmail) => {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SIGN_IN_FROM, to: [email.to], subject: email.subject, text: email.text, html: email.html, tags: [{ name: "type", value: "sign_in_code" }, { name: "kind", value: email.kind.replace("-", "_") }] }),
    });
    if (!response.ok) throw new Error(`Resend refused a ${email.kind} email (${response.status}).`);
  };
}
