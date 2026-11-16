"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAutomation, updateAutomation } from "../actions";

// Pause or turn on, and delete (asks to confirm first).
export function AutomationControls(props: { id: string; active: boolean; backHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "Something went wrong.");
    after?.();
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span role="alert" className="text-xs text-ps-failed-text">{error}</span>}
      <button type="button" disabled={busy} onClick={() => run(() => updateAutomation(props.id, { is_active: !props.active }))} className="h-9 rounded-lg border border-ps-line-strong px-3 text-[13px] hover:border-ps-fg/30 disabled:opacity-60">
        {props.active ? "Pause" : "Turn on"}
      </button>
      {confirm ? (
        <button type="button" disabled={busy} onClick={() => run(() => deleteAutomation(props.id), () => router.push(props.backHref))} className="h-9 rounded-lg border border-ps-failed/40 px-3 text-[13px] text-ps-failed-text disabled:opacity-60">
          Delete it and its activity
        </button>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="h-9 rounded-lg px-2 text-[13px] text-ps-failed-text hover:underline">Delete</button>
      )}
    </div>
  );
}
