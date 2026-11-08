"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markPublished, retry } from "@/app/beta/(app)/calendar/actions";

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", threads: "Threads", youtube: "YouTube",
  tiktok: "TikTok", linkedin: "LinkedIn", bluesky: "Bluesky", x: "X",
};

type Step = null | "live" | "again";

// For one account a post failed on: send it again, or record that it went live anyway.
// When the failed attempt may have reached the platform, Retry looks there first; posting
// again without that check asks for a second click.
export function FailedPostActions({ postId, accountId, platform, mayBeLive, onDone }: { postId: string; accountId: string; platform: string; mayBeLive: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Step>(null);
  const name = PLATFORM_NAMES[platform] ?? platform;

  async function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const r = await run();
    setBusy(false);
    setConfirm(null);
    if (!r.ok) return setError(r.error ?? "That didn't work. Try again.");
    onDone?.();
    router.refresh();
  }

  const button = "h-7 rounded-lg border border-ps-fg/[0.12] px-2.5 text-xs hover:border-ps-fg/25 disabled:opacity-60";
  return (
    <div className="flex flex-col gap-1.5">
      {mayBeLive && <p className="m-0 text-xs text-ps-muted">This may already be on {name}. Retry checks there before posting again.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-attr="retry-post" disabled={busy} onClick={() => act(() => retry(postId, accountId))} className={button}>
          {busy && !confirm ? "Sending…" : "Retry"}
        </button>
        {confirm === "live" ? (
          <button type="button" data-attr="mark-post-published" disabled={busy} onClick={() => act(() => markPublished(postId, accountId))} className={button}>{`Confirm it's live on ${name}`}</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => setConfirm("live")} className={button}>{"It's live"}</button>
        )}
        {mayBeLive && (confirm === "again" ? (
          <button type="button" data-attr="retry-post-start-over" disabled={busy} onClick={() => act(() => retry(postId, accountId, true))} className="h-7 rounded-lg border border-ps-failed/40 px-2.5 text-xs text-ps-failed-text disabled:opacity-60">This may post twice. Post again</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => setConfirm("again")} className="h-7 px-1 text-xs text-ps-subtle hover:text-ps-text">Post again anyway</button>
        ))}
      </div>
      {error && <p role="alert" className="m-0 text-xs text-ps-failed-text">{error}</p>}
    </div>
  );
}
