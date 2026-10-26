"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { unsubscribe } from "./actions";

// A button, not an automatic unsubscribe on opening the page: email scanners open links too.
export function UnsubscribeForm({ u, t }: { u: string; t: string }) {
  const [state, action, pending] = useActionState(unsubscribe, null);
  if (state?.ok) return <p role="status" className="mt-6 text-ink">You&apos;re unsubscribed. We won&apos;t send you these emails again.</p>;
  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="u" value={u} />
      <input type="hidden" name="t" value={t} />
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Unsubscribing…" : "Unsubscribe"}</Button>
      {state && !state.ok && <p role="alert" className="mt-4 text-sm text-ink-muted">{state.error}</p>}
    </form>
  );
}
