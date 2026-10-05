"use server";

// Joins the waitlist through the `api` function (the only thing that can write to it).
export type WaitlistResult = { ok: true } | { ok: false; error: string };

export async function joinWaitlist(_prev: WaitlistResult | null, form: FormData): Promise<WaitlistResult> {
  // A field people never see; bots that fill every input get a quiet "you're on the list".
  if (String(form.get("company") ?? "")) return { ok: true };
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { ok: false, error: "Enter your email address." };
  const base = process.env.API_BASE_URL;
  if (!base) return { ok: false, error: "The waitlist isn't open yet. Try again soon." };
  const response = await fetch(`${base}/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, source: "landing" }),
    cache: "no-store",
  }).catch(() => null);
  if (response?.ok) return { ok: true };
  const body = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { ok: false, error: body?.error?.message ?? "Joining the waitlist failed. Try again." };
}
