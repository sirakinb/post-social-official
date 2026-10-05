// Rate limits: generous enough that real people and their AIs never meet them, low enough
// to stop abuse and runaway scripts early. Open endpoints (no sign-in) are limited per
// network address; signed-in callers per person, key or AI connection.
//
// Counters live in public.rate_limits (take_rate_limit). Addresses and emails are hashed
// before they are stored. If the counter can't be reached, the request is allowed and the
// failure reported: a limiter outage must not lock everyone out.
import { ApiError, type Sql } from "./access";
import { reportError } from "./telemetry";

export const LIMITS = {
  // Open to everyone
  waitlist_ip: { limit: 5, windowSeconds: 3600 },
  oauth_register_ip: { limit: 20, windowSeconds: 3600 },
  oauth_token_ip: { limit: 120, windowSeconds: 60 },
  // Per email AND address, so a stranger can't use up someone's attempts; the email-only
  // caps are a high backstop against attacks spread over many addresses.
  signin_ip: { limit: 20, windowSeconds: 600 },
  signin_email_ip: { limit: 10, windowSeconds: 900 },
  signin_email: { limit: 100, windowSeconds: 3600 },
  reset_request_ip: { limit: 10, windowSeconds: 3600 },
  reset_request_email: { limit: 3, windowSeconds: 3600 }, // over it: same answer, no email sent
  reset_complete_email_ip: { limit: 10, windowSeconds: 3600 },
  reset_complete_email: { limit: 30, windowSeconds: 3600 },
  // Every /v1 and /mcp request per address, checked before the key: stops floods of bad keys.
  api_ip: { limit: 600, windowSeconds: 60 },
  // Signed in (on top of each plan's daily API limit)
  api_credential: { limit: 120, windowSeconds: 60 },
  person_user: { limit: 120, windowSeconds: 60 },
  consent_user: { limit: 30, windowSeconds: 60 },
  media_user: { limit: 300, windowSeconds: 60 },
  media_upload_user: { limit: 100, windowSeconds: 3600 },
} as const;

export type LimitName = keyof typeof LIMITS;

export class RateLimitError extends ApiError {
  constructor(public retryAfter: number, message = "Too many requests. Try again in a little while.") {
    super(429, message);
  }
}

// A short, one-way id for an address or email, so counters never hold the raw value. Keyed
// (HMAC) with a server secret, so ids can't be reversed by hashing every address or a list
// of likely emails.
export async function hashId(value: string, secret?: string | null): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const bytes = secret
    ? await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), data)
    : await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(bytes).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

// One id per network: an IPv6 /64 is what one home or server gets, so counting each
// address in it separately would give an attacker billions of fresh limits.
export function networkOf(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => (g || "0").toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// Seconds to wait (0 = go ahead). Never throws for infrastructure trouble.
export async function takeLimit(sql: Sql, name: LimitName, id: string): Promise<number> {
  const { limit, windowSeconds } = LIMITS[name];
  try {
    const [row] = await sql<{ wait: number }>(`SELECT public.take_rate_limit($1, $2, $3) AS wait`, [`${name}:${id}`, limit, windowSeconds]);
    return Number(row?.wait ?? 0);
  } catch (error) {
    reportError(error, { area: "rate limit", limit: name });
    return 0;
  }
}

// Throws a 429 when over the limit.
export async function enforceLimit(sql: Sql, name: LimitName, id: string, message?: string) {
  const wait = await takeLimit(sql, name, id);
  if (wait > 0) throw new RateLimitError(wait, message);
}

export function retryHeaders(error: unknown): Record<string, string> {
  return error instanceof RateLimitError ? { "Retry-After": String(error.retryAfter) } : {};
}

// The caller's network address. The gateway in front of the functions appends the real
// connecting address to X-Forwarded-For, so only the LAST entry can be trusted; anything
// before it is whatever the caller sent. Requests our own website forwards come from
// Vercel's address, so the website passes the visitor's address in X-PS-Client-IP with a
// shared secret (X-PS-Proxy-Secret); that header is believed only with the right secret.
export function clientIp(request: Request, proxySecret?: string | null): string {
  const claimed = request.headers.get("x-ps-client-ip");
  if (claimed && fromOurWebsite(request, proxySecret)) return networkOf(claimed.trim());
  const chain = (request.headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return networkOf(chain[chain.length - 1] ?? "unknown");
}

// True when the request carries our website's shared secret.
export function fromOurWebsite(request: Request, proxySecret?: string | null) {
  const proof = request.headers.get("x-ps-proxy-secret");
  return Boolean(proxySecret && proof && sameSecret(proof, proxySecret));
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
