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
  signin_ip: { limit: 20, windowSeconds: 600 },
  signin_email: { limit: 10, windowSeconds: 900 },
  reset_request_ip: { limit: 10, windowSeconds: 3600 },
  reset_request_email: { limit: 3, windowSeconds: 3600 },
  reset_complete_email: { limit: 10, windowSeconds: 3600 },
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

// A short, one-way id for an address or email, so counters never hold the raw value.
export async function hashId(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(bytes).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
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
  if (claimed && fromOurWebsite(request, proxySecret)) return claimed.trim();
  const chain = (request.headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return chain[chain.length - 1] ?? "unknown";
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
