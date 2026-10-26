"use server";

// Records an unsubscribe from the nudge emails through the `api` function, which checks the
// link's signature (backend/lib/nudges.ts).
export type UnsubscribeResult = { ok: true } | { ok: false; error: string };

export async function unsubscribe(_prev: UnsubscribeResult | null, form: FormData): Promise<UnsubscribeResult> {
  const u = String(form.get("u") ?? "");
  const t = String(form.get("t") ?? "");
  const base = process.env.API_BASE_URL;
  if (!base) return { ok: false, error: "Unsubscribing isn't available right now. Write to support@postsocial.xyz and we'll do it for you." };
  const response = await fetch(`${base}/email/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u, t }),
    cache: "no-store",
  }).catch(() => null);
  if (response?.ok) return { ok: true };
  const body = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { ok: false, error: body?.error?.message ?? "Unsubscribing failed. Try again, or write to support@postsocial.xyz." };
}
