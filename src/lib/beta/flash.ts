// Notices shown after a redirect (finishing an account connection, billing actions). The
// address only carries a short code, and pages show fixed wording for the codes they know and
// ignore anything else, so a crafted link can't put its own words in an official-looking
// notice. When our own server wrote a more specific message, it travels in a short-lived
// cookie that only this site can set, and is shown in place of the fixed wording.
import { OUR_SIDE, UNREACHABLE } from "../../../backend/lib/support";

export const FLASH_COOKIE = "ps_flash";
export const FLASH_SECONDS = 60;
const FLASH_MAX_LENGTH = 600;

export type FlashKind = "error" | "notice";

// The cookie's value for a message (kept short; cookies are small).
export function flashValue(kind: FlashKind, text: string) {
  return `${kind}:${encodeURIComponent(text.slice(0, FLASH_MAX_LENGTH))}`;
}

// The message in the cookie, if it is of this kind.
export function readFlash(raw: string | null | undefined, kind: FlashKind) {
  if (!raw || !raw.startsWith(`${kind}:`)) return null;
  try {
    const text = decodeURIComponent(raw.slice(kind.length + 1)).trim();
    return text ? text.slice(0, FLASH_MAX_LENGTH) : null;
  } catch {
    return null;
  }
}

export const flashCookie = (kind: FlashKind, text: string) => ({
  name: FLASH_COOKIE,
  value: flashValue(kind, text),
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/beta",
  maxAge: FLASH_SECONDS,
});

// The wording for a code from the address: our server's message for this code when the
// cookie has one, otherwise the fixed wording. Unknown codes show nothing.
export function noticeText(table: Readonly<Record<string, string>>, code: string | null | undefined, flash: string | null = null) {
  if (!code || !Object.hasOwn(table, code)) return null;
  return FLASH_CODES.has(code) && flash ? flash : table[code];
}

// Codes whose fixed wording is a fallback for a more specific message in the cookie.
const FLASH_CODES = new Set(["connected", "connect_failed", "billing_failed"]);

// /beta/accounts?message=<code>
export const ACCOUNT_NOTICES = {
  connected: "Connected.",
} as const;

// /beta/accounts?error=<code>
export const ACCOUNT_ERRORS = {
  connect_failed: "The connection could not be finished.",
  connect_expired: "This connection request expired or was already used. Start again.",
  session_ended: "Your session ended. Sign in and connect again.",
  unreachable: UNREACHABLE,
  our_side: OUR_SIDE,
} as const;

// /beta/billing?error=<code>
export const BILLING_ERRORS = {
  billing_failed: "That didn't work. Try again.",
  session_ended: "Your session ended. Sign in again.",
  unreachable: UNREACHABLE,
  our_side: OUR_SIDE,
} as const;

export type AccountErrorCode = keyof typeof ACCOUNT_ERRORS;
export type BillingErrorCode = keyof typeof BILLING_ERRORS;
