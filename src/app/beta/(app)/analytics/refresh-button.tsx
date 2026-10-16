"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { refreshStats } from "./actions";

// "Refresh now" with how many hand refreshes are left today (stats also update on their own).
export function RefreshButton({ workspaceId, left }: { workspaceId: string; left: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(left);
  const [message, setMessage] = useState<string | null>(null);
  async function refresh() {
    setBusy(true);
    const result = await refreshStats(workspaceId);
    setBusy(false);
    setMessage(result.message);
    if (result.left !== undefined) setRemaining(result.left);
    if (result.ok) setTimeout(() => router.refresh(), 20_000);
  }
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy || remaining === 0} onClick={refresh}>
        {busy ? "Refreshing…" : `Refresh now · ${remaining} left today`}
      </Button>
      {message && <span role="status" className="max-w-[16rem] text-xs text-ps-subtle">{message}</span>}
    </div>
  );
}
