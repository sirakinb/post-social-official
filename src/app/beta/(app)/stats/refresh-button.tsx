"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { refreshStats } from "./actions";

export function RefreshButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function refresh() {
    setBusy(true);
    const result = await refreshStats(workspaceId);
    setBusy(false);
    setMessage(result.message);
    if (result.ok) setTimeout(() => router.refresh(), 20_000);
  }
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={refresh}>{busy ? "Refreshing…" : "Refresh now"}</Button>
      {message && <span role="status" className="max-w-[16rem] text-xs text-ink-subtle">{message}</span>}
    </div>
  );
}
