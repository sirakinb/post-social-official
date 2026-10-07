"use client";

import { useEffect, useRef } from "react";
import type { ComposerMedia, Cover } from "@/lib/beta/composer-model";
import { cn } from "@/lib/utils";

type Note = { accountId: string; label: string; text: string };
type Upload = { key: string; name: string; progress: number; error?: string; status: string };

// The video's cover: its first frame, a frame the person picks, or an image from the library.
// Shows the 9:16 cover and the centred square Instagram uses in the profile grid, and what
// each chosen account will actually get.
export function CoverPicker({ video, images, cover, onChange, notes, onUpload, uploads }: {
  video: ComposerMedia;
  images: ComposerMedia[];
  cover: Cover;
  onChange: (cover: Cover) => void;
  notes: Note[];
  onUpload: (file: File) => void;
  uploads: Upload[];
}) {
  const durationMs = Math.max(0, Math.floor((video.duration ?? 0) * 1000));
  const image = cover.kind === "image" ? images.find((m) => m.id === cover.mediaId) ?? null : null;
  const ms = cover.kind === "frame" ? cover.ms : 0;

  const picture = (shape: "tall" | "square") => (
    <div className={cn("overflow-hidden rounded-lg border border-white/[0.08] bg-ps-ground", shape === "tall" ? "aspect-[9/16] w-[96px]" : "aspect-square w-[96px]")}>
      {image?.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url} alt="" className="h-full w-full object-cover" />
      ) : video.url ? (
        <FrameVideo src={video.url} poster={video.poster ?? undefined} ms={ms} />
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-white/[0.08] bg-ps-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Cover</span>
        <span className="inline-flex rounded-[9px] border border-white/[0.08] bg-ps-ground p-[3px]" role="radiogroup" aria-label="Cover">
          {([["default", "First frame"], ["frame", "Pick a frame"], ["image", "Image"]] as const).map(([kind, text]) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={cover.kind === kind}
              onClick={() => onChange(kind === "default" ? { kind } : kind === "frame" ? { kind, ms: cover.kind === "frame" ? cover.ms : 0 } : { kind, mediaId: cover.kind === "image" ? cover.mediaId : (images[0]?.id ?? "") })}
              className={cn("h-7 rounded-md px-2.5 text-xs", cover.kind === kind ? "bg-[#2A2142] text-ps-text" : "text-ps-muted hover:text-ps-text")}
            >
              {text}
            </button>
          ))}
        </span>
      </div>

      {cover.kind === "frame" && (
        <label className="flex flex-col gap-1.5">
          <span className="flex justify-between text-xs text-ps-muted">Frame <span className="font-mono">{(ms / 1000).toFixed(1)}s</span></span>
          <input id="cover-frame" type="range" min={0} max={durationMs} step={100} value={ms} onChange={(e) => onChange({ kind: "frame", ms: Number(e.target.value) })} className="accent-[#9B6CFF]" />
        </label>
      )}

      {cover.kind === "image" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {images.slice(0, 12).map((m) => (
              <button key={m.id} type="button" aria-label={`Use ${m.name} as the cover`} aria-pressed={cover.mediaId === m.id} onClick={() => onChange({ kind: "image", mediaId: m.id })}
                className={cn("h-14 w-14 overflow-hidden rounded-md border-2", cover.mediaId === m.id ? "border-ps-plum" : "border-transparent opacity-80 hover:opacity-100")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.url && <img src={m.url} alt="" className="h-full w-full object-cover" />}
              </button>
            ))}
            <label className="flex h-14 cursor-pointer items-center rounded-md border border-dashed border-white/[0.18] px-3 text-xs text-ps-muted hover:text-ps-text">
              Upload image
              <input id="cover-upload" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
            </label>
          </div>
          {uploads.map((u) => (
            <span key={u.key} className="text-xs text-ps-subtle">{u.error ? `${u.name}: ${u.error}` : `${u.name}: ${u.status === "checking" ? "checking…" : `uploading ${Math.round(u.progress * 100)}%`}`}</span>
          ))}
          {images.length === 0 && uploads.length === 0 && <span className="text-xs text-ps-subtle">Upload a JPEG, PNG or WebP. It&apos;s used as the cover only, not added to the post.</span>}
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-1 text-[11px] text-ps-subtle">{picture("tall")}Cover</div>
        <div className="flex flex-col items-center gap-1 text-[11px] text-ps-subtle">{picture("square")}Instagram grid</div>
        <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1 p-0 text-xs">
          {notes.map((n) => (
            <li key={n.accountId} className="min-w-0"><span className="text-ps-text">{n.label}:</span> <span className="text-ps-muted">{n.text}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// The video, held still at `ms`.
function FrameVideo({ src, poster, ms }: { src: string; poster?: string; ms: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && Math.abs(v.currentTime * 1000 - ms) > 40) v.currentTime = ms / 1000;
  }, [ms]);
  return <video ref={ref} src={src} poster={poster} muted playsInline preload="auto" className="h-full w-full object-cover" />;
}
