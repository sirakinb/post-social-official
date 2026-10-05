"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActorMark, type ActorKind } from "@/components/beta/marks";
import { useUpload } from "@/components/beta/use-upload";
import { formatBytes } from "@/lib/media/part-upload";
import { cn } from "@/lib/utils";
import { callMedia } from "./actions";

export type LibraryItem = {
  id: string;
  status: string;
  name: string;
  type: "image" | "video";
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  failure: string | null;
  hidden: boolean;
  createdAt: string;
  by: { kind: string; name: string } | null;
  usedIn: number;
  url: string | null;
  poster: string | null;
};

type Filter = "all" | "video" | "image" | "unused";

const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const kind = (mime: string) => (mime.split("/")[1] ?? "").replace("quicktime", "mov").toUpperCase();

// Where a file fits, in plain words, from its shape and length.
export function fitsFor(m: Pick<LibraryItem, "type" | "width" | "height" | "duration">) {
  if (!m.width || !m.height) return "Checking the file…";
  const ratio = m.width / m.height;
  if (m.type === "image") {
    const places = ["Facebook", "Threads"];
    if (ratio >= 0.8 && ratio <= 1.91) places.unshift("Instagram feed");
    return places.join(", ");
  }
  const vertical = ratio < 1;
  const d = m.duration ?? 0;
  const places: string[] = [];
  if (vertical && d >= 3 && d <= 90) places.push("Instagram and Facebook Reels");
  if (vertical && d <= 180) places.push("YouTube Shorts");
  if (d >= 3) places.push("TikTok");
  if (d <= 300) places.push("Threads");
  if (!vertical) places.push("Facebook video");
  return places.length ? places.join(", ") : "Too long for most platforms";
}

export function MediaView({ workspaceId, items, showHidden, loadError, canEdit }: { workspaceId: string; items: LibraryItem[]; showHidden: boolean; loadError: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [message, setMessage] = useState<{ kind: "error" | "notice"; text: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const { uploads, upload, dismiss } = useUpload(workspaceId, () => router.refresh());

  // While anything is being checked, refresh until it settles.
  const checking = items.some((i) => i.status === "processing");
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [checking, router]);

  const shown = items.filter((i) => filter === "all" || (filter === "unused" ? i.usedIn === 0 : i.type === filter));
  const selected = items.find((i) => i.id === selectedId) ?? shown[0] ?? null;
  const total = items.reduce((sum, i) => sum + (["ready", "processing"].includes(i.status) ? i.size : 0), 0);

  async function onImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const url = String(new FormData(form).get("url") ?? "");
    setImporting(true);
    setMessage(null);
    const r = await callMedia({ action: "import", workspace_id: workspaceId, url });
    setImporting(false);
    if (!r.ok) return setMessage({ kind: "error", text: r.error });
    form.reset();
    setImportOpen(false);
    setMessage({ kind: "notice", text: "Importing. It appears in your library once it's checked." });
    router.refresh();
  }

  async function act(payload: { action: string } & Record<string, unknown>, done?: string) {
    setMessage(null);
    const r = await callMedia(payload);
    if (!r.ok) setMessage({ kind: "error", text: r.error });
    else if (done) setMessage({ kind: "notice", text: done });
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-wrap">
      <section aria-label="Library" className="flex min-w-0 flex-[1_1_560px] flex-col gap-4 px-8 pb-12 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="m-0 text-lg font-medium">{showHidden ? "Hidden media" : "Media"}</h1>
            <span className="font-mono text-xs text-ps-subtle">{items.length} files · {formatBytes(total)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={showHidden ? "/beta/media" : "/beta/media?hidden=1"} className="text-xs text-ps-muted hover:text-ps-text">{showHidden ? "Back to library" : "Hidden"}</Link>
            {canEdit && !showHidden && (
              <>
                <button type="button" onClick={() => setImportOpen((v) => !v)} className="h-8 rounded-lg border border-white/[0.12] px-3 hover:border-white/25">From a link</button>
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" multiple className="sr-only" onChange={(e) => { for (const f of Array.from(e.target.files ?? [])) void upload(f); e.target.value = ""; }} />
                <button type="button" onClick={() => file.current?.click()} className="h-8 rounded-lg bg-ps-plum px-3.5 font-medium text-ps-ground hover:bg-[#AD86FF]">Upload</button>
              </>
            )}
          </div>
        </div>

        {importOpen && (
          <form onSubmit={onImport} className="flex flex-wrap gap-2 rounded-xl border border-ps-line bg-ps-surface p-3">
            <label htmlFor="import-url" className="sr-only">Link to an image or video</label>
            <input id="import-url" name="url" type="url" required placeholder="https://… link to an image or video" className="h-9 min-w-[260px] flex-1 rounded-lg border border-ps-line-strong bg-ps-ground px-3 text-[13px]" />
            <button type="submit" disabled={importing} className="h-9 rounded-lg bg-ps-plum px-3.5 font-medium text-ps-ground disabled:opacity-60">{importing ? "Starting…" : "Import"}</button>
          </form>
        )}
        {message && <p role={message.kind === "error" ? "alert" : "status"} className={cn("m-0 rounded-lg border px-3 py-2", message.kind === "error" ? "border-ps-failed/30 bg-ps-failed/[0.08] text-[#FF8A8E]" : "border-ps-line bg-ps-surface text-ps-muted")}>{message.text}</p>}
        {loadError && <p role="alert" className="m-0 text-[#FF8A8E]">Your media could not be loaded. Refresh the page to try again.</p>}

        <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Filter">
          {(
            [
              ["all", "All"],
              ["video", "Videos"],
              ["image", "Images"],
              ["unused", "Not used yet"],
            ] as const
          ).map(([id, text]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn("h-7 rounded-full border px-3 text-xs", filter === id ? "border-ps-plum/50 bg-ps-plum/[0.14] text-ps-text" : "border-white/[0.08] text-ps-muted hover:text-ps-text")}>
              {text}
            </button>
          ))}
        </div>

        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {uploads.map((u) => (
              <div key={u.key} className="flex w-[220px] flex-col gap-1.5 rounded-xl border border-ps-line bg-ps-surface px-3 py-2.5">
                <span className="truncate text-xs">{u.name}</span>
                {u.error ? (
                  <span className="text-xs text-[#FF8A8E]">{u.error} <button type="button" onClick={() => dismiss(u.key)} className="underline">Dismiss</button></span>
                ) : (
                  <>
                    <span className="h-[3px] rounded bg-white/[0.06]"><span className="block h-full rounded bg-ps-plum" style={{ width: `${Math.round(u.progress * 100)}%` }} /></span>
                    <span className="text-[11px] text-ps-subtle">{u.status === "checking" ? "Checking the file…" : `Uploading ${Math.round(u.progress * 100)}%`}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <p className="m-0 rounded-xl border border-ps-line bg-ps-surface px-4 py-14 text-center text-ps-muted">
            {showHidden ? "Nothing hidden." : filter === "all" ? "No media yet. Upload a photo or video, or ask your AI to import one from a link." : "Nothing matches this filter."}
          </p>
        ) : (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]">
            {shown.map((m) => {
              const picture = m.type === "image" ? m.url : m.poster;
              const bad = m.status === "failed" || m.status === "expired";
              return (
                <button key={m.id} type="button" onClick={() => setSelectedId(m.id)} aria-pressed={selected?.id === m.id} className={cn("rounded-xl border p-2 text-left text-[12.5px]", selected?.id === m.id ? "border-ps-plum/65 bg-ps-plum/[0.08]" : bad ? "border-ps-failed/35 bg-ps-surface" : "border-white/[0.06] bg-ps-surface hover:border-white/20")}>
                  <span className="relative mx-auto block max-h-[220px] max-w-full overflow-hidden rounded-lg bg-ps-raised" style={{ aspectRatio: m.width && m.height ? `${m.width} / ${m.height}` : "1 / 1" }}>
                    {picture ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed link to private storage
                      <img src={picture} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-ps-subtle">{m.type === "video" ? "▶" : ""}</span>
                    )}
                    {m.duration !== null && m.status === "ready" && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 font-mono text-[10px]">{duration(m.duration)}</span>}
                    {m.status === "processing" && <span className="absolute inset-x-2 bottom-2 text-[11px]">Checking…<span className="mt-1 block h-[3px] overflow-hidden rounded bg-white/15"><span className="block h-full w-1/2 animate-pulse rounded bg-ps-plum" /></span></span>}
                  </span>
                  <span className="mt-2 block truncate">{m.name}</span>
                  <span className="mt-0.5 flex justify-between gap-1.5 font-mono text-[10.5px] text-ps-subtle">
                    <span className="truncate">{kind(m.mime)} · {formatBytes(m.size)}</span>
                    {bad && <span className="text-[#FF8A8E]">{m.status === "expired" ? "Expired" : "Can't use"}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selected && (
        <aside aria-label="Details" className="flex min-w-[280px] flex-[0_1_340px] flex-col gap-3.5 border-l border-white/[0.06] bg-ps-sidebar px-6 py-5">
          <div className="overflow-hidden rounded-[10px] border border-white/[0.08] bg-ps-raised" style={{ aspectRatio: selected.width && selected.height ? `${selected.width} / ${selected.height}` : "1 / 1", maxHeight: 380 }}>
            {selected.type === "video" && selected.url ? (
              <video key={selected.id} src={selected.url} poster={selected.poster ?? undefined} controls preload="metadata" className="h-full w-full object-contain" />
            ) : selected.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed link to private storage
              <img src={selected.url} alt="" className="h-full w-full object-contain" />
            ) : null}
          </div>
          <div>
            <div className="break-words text-sm font-medium">{selected.name}</div>
            <div className="mt-1 font-mono text-[11px] text-ps-subtle">
              {kind(selected.mime)}{selected.width ? ` · ${selected.width}×${selected.height}` : ""}{selected.duration !== null ? ` · ${duration(selected.duration)}` : ""} · {formatBytes(selected.size)}
            </div>
          </div>
          <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-y-2 text-xs">
            <dt className="text-ps-subtle">Added by</dt>
            <dd className="m-0 flex items-center gap-1.5">{selected.by ? <><ActorMark kind={selected.by.kind as ActorKind} name={selected.by.name} size={16} />{selected.by.name}</> : "Post Social"}</dd>
            <dt className="text-ps-subtle">Added</dt>
            <dd className="m-0">{new Date(selected.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd>
            <dt className="text-ps-subtle">Status</dt>
            <dd className={cn("m-0", selected.status === "ready" ? "text-ps-live" : selected.status === "processing" ? "text-ps-plum-soft" : "text-[#FF8A8E]")}>
              {selected.status === "ready" ? "Ready" : selected.status === "processing" ? "Checking" : selected.status === "expired" ? "Expired (unused for 30 days)" : selected.failure ?? "Can't be used"}
            </dd>
            {selected.status === "ready" && (
              <>
                <dt className="text-ps-subtle">Fits</dt>
                <dd className="m-0">{fitsFor(selected)}</dd>
              </>
            )}
            <dt className="text-ps-subtle">Used in</dt>
            <dd className="m-0">{selected.usedIn ? `${selected.usedIn} post${selected.usedIn === 1 ? "" : "s"}` : "Not used yet"}</dd>
          </dl>
          {canEdit && (
            <div className="mt-1 flex gap-2">
              {selected.status === "ready" && !selected.hidden && (
                <Link href={`/beta/create?media=${selected.id}`} className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-ps-plum font-medium text-ps-ground hover:bg-[#AD86FF]">Use in a post</Link>
              )}
              <button type="button" onClick={() => act({ action: "set_hidden", media_id: selected.id, hidden: !selected.hidden }, selected.hidden ? "Back in your library." : "Hidden from your library.")} className="h-8 flex-1 rounded-lg border border-white/[0.12] hover:border-white/25">
                {selected.hidden ? "Show in library" : "Hide"}
              </button>
            </div>
          )}
          <p className="m-0 text-[11px] leading-relaxed text-ps-subtle">Files not used in a post for 30 days are removed to save storage.</p>
        </aside>
      )}
    </div>
  );
}
