"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocalTime } from "@/components/beta/local-time";
import { ActorMark, type ActorKind } from "@/components/beta/marks";
import { PlatformMark, PLATFORM_NAMES, Thumb } from "@/components/beta/ui";
import { cn } from "@/lib/utils";
import { deleteDraft } from "./actions";

export type DraftItem = {
  id: string;
  caption: string;
  plannedAt: string | null;
  updatedAt: string;
  by: { kind: ActorKind; name: string; text: string } | null;
  thumb: { url: string | null; isVideo: boolean } | null;
  destinations: Array<{ platform: string; account: string }>;
};

// One line per draft, newest first: open it in the composer, or delete it.
export function DraftsList({ drafts, canEdit }: { drafts: DraftItem[]; canEdit: boolean }) {
  if (drafts.length === 0) return <p className="m-0 px-4 py-10 text-center text-ps-muted">No drafts. Posts you or your AI apps save without scheduling show up here.</p>;
  return (
    <ul aria-label="Drafts" className="m-0 list-none p-0">
      {drafts.map((d) => <DraftLine key={d.id} draft={d} canEdit={canEdit} />)}
    </ul>
  );
}

function DraftLine({ draft: d, canEdit }: { draft: DraftItem; canEdit: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const r = await deleteDraft(d.id);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That didn't work. Try again.");
    router.refresh();
  }

  const body = (
    <>
      <Thumb url={d.thumb?.url ?? null} isVideo={d.thumb?.isVideo ?? false} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{d.caption || "No caption"}</span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ps-subtle">
          <span className="flex items-center gap-1">
            {d.destinations.map((x, i) => (
              <span key={i} title={x.account ? `${x.account} on ${PLATFORM_NAMES[x.platform] ?? x.platform}` : undefined} className="inline-flex">
                <PlatformMark platform={x.platform} size={16} className="rounded-[5px]" />
              </span>
            ))}
            {d.destinations.length === 0 && "No accounts picked"}
          </span>
          {d.by && (
            <span className="flex min-w-0 items-center gap-1.5">
              <ActorMark kind={d.by.kind} name={d.by.name} size={14} />
              <span className="truncate">{d.by.text}</span>
            </span>
          )}
          {d.plannedAt && (
            <span>
              For <LocalTime iso={d.plannedAt} style="when" />
            </span>
          )}
        </span>
      </span>
      <LocalTime iso={d.updatedAt} style="when" className="hidden flex-none font-mono text-xs text-ps-subtle md:block" />
    </>
  );

  return (
    <li className={cn("flex items-center border-b border-ps-fg/[0.05] last:border-b-0", busy && "opacity-60")}>
      {canEdit ? (
        <Link href={`/beta/create?post=${d.id}`} data-attr="open-draft" className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-ps-fg/[0.02]">{body}</Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">{body}</div>
      )}
      {canEdit && (
        <div className="flex flex-none items-center gap-2 pr-4">
          {error && <span role="alert" className="max-w-[180px] truncate text-xs text-ps-failed-text" title={error}>{error}</span>}
          {confirming ? (
            <>
              <button type="button" data-attr="delete-draft" disabled={busy} onClick={remove} className="h-7 rounded-md border border-ps-failed/40 px-2.5 text-xs text-ps-failed-text">
                {busy ? "Deleting…" : "Delete"}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="h-7 px-1.5 text-xs text-ps-subtle hover:text-ps-text">Keep</button>
            </>
          ) : (
            <button type="button" aria-label={`Delete draft: ${d.caption || "No caption"}`} onClick={() => setConfirming(true)} className="flex h-7 w-7 items-center justify-center rounded-md text-ps-subtle hover:bg-ps-fg/[0.04] hover:text-ps-failed-text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></svg>
            </button>
          )}
        </div>
      )}
    </li>
  );
}
