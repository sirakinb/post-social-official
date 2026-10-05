// The landing page's waitlist. Anyone may join, so the answer never says whether an email
// was already on the list, and a burst of sign-ups from everyone at once is slowed down
// (a per-visitor limit comes with the Phase 8 rate limits).
import { ApiError, type Sql } from "./access";

const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
export const WAITLIST_BURST = { limit: 300, minutes: 10 };

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export async function joinWaitlist(sql: Sql, input: Record<string, unknown>): Promise<{ ok: true }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new ApiError(400, "Enter a valid email address.");
  const source = typeof input.source === "string" ? input.source.slice(0, 64) : null;
  const [recent] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM public.waitlist WHERE created_at > now() - make_interval(mins => $1)`, [WAITLIST_BURST.minutes]);
  if ((recent?.n ?? 0) >= WAITLIST_BURST.limit) throw new ApiError(429, "Lots of people are joining right now. Try again in a few minutes.");
  await sql(`INSERT INTO public.waitlist (email, source) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`, [email, source]);
  return { ok: true };
}
