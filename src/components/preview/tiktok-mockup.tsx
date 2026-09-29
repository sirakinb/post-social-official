"use client";

import { Bookmark, Heart, MessageCircle, Music2, Play, Plus, Search, Share2 } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { isKnownNonVertical, mediaFit } from "@/lib/media-fit";
import { MockCaption } from "./mock-caption";
import type { MockupProps } from "./types";

// The visible part of a caption in TikTok's feed is about two lines at phone width.
const FEED_CAPTION_CHARS = 90;

/** An approximation of TikTok's For You feed. It is not pixel-exact and shows no real counts. */
export function TikTokMockup({ media, caption, account, showSafeZones }: MockupProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const fit = mediaFit(media?.width, media?.height);
  const fitClass = fit === "cover" ? "object-cover" : "object-contain";
  const handle = account.handle ? `@${account.handle.replace(/^@/, "")}` : account.name;

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    // play() rejects if the element is removed mid-play (for example when switching tabs); that is harmless.
    if (video.paused) void video.play?.()?.catch(() => undefined);
    else video.pause?.();
  }

  return (
    <div className="mx-auto w-full max-w-[300px] space-y-3" data-testid="tiktok-mockup">
      <div className="relative aspect-[9/19] overflow-hidden rounded-[2.25rem] border-[6px] border-neutral-900 bg-black shadow-xl">
        {media?.url ? (
          media.mediaType === "video" ? (
            <video
              ref={videoRef}
              src={`${media.url}#t=0.1`}
              loop
              playsInline
              preload="metadata"
              aria-label={`Preview of ${media.fileName}`}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={toggle}
              className={`absolute inset-0 h-full w-full ${fitClass}`}
            />
          ) : (
            <Image unoptimized fill src={media.url} alt={`Preview of ${media.fileName}`} className={fitClass} />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-white/60">{media ? "This file is no longer available." : "No media attached."}</div>
        )}

        {media?.mediaType === "video" && media.url && !playing ? (
          <button type="button" onClick={toggle} aria-label="Play preview" className="absolute left-1/2 top-[42%] flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white">
            <Play className="h-7 w-7 fill-white" />
          </button>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center gap-4 bg-gradient-to-b from-black/50 to-transparent px-4 pb-4 pt-3 text-[11px] font-semibold text-white">
          <span className="text-white/60">Following</span>
          <span className="border-b-2 border-white pb-0.5">For You</span>
          <Search className="absolute right-4 h-4 w-4" aria-hidden="true" />
        </div>

        <div className="pointer-events-none absolute bottom-[11%] right-2 flex flex-col items-center gap-3.5 text-white">
          <div className="relative mb-1">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-neutral-700 text-[11px] font-bold">
              {account.avatarUrl ? <Image unoptimized src={account.avatarUrl} alt="" width={36} height={36} className="h-full w-full object-cover" /> : account.name.charAt(0).toUpperCase()}
            </div>
            <span className="absolute -bottom-2 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-[#fe2c55]"><Plus className="h-3 w-3" aria-hidden="true" /></span>
          </div>
          {[{ Icon: Heart, label: "Like" }, { Icon: MessageCircle, label: "Comment" }, { Icon: Bookmark, label: "Save" }, { Icon: Share2, label: "Share" }].map(({ Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-0.5">
              <Icon className="h-6 w-6 fill-white/90" aria-hidden="true" />
              <span className="text-[9px] font-medium">{label}</span>
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-[11%] left-3 right-16 space-y-1.5 bg-gradient-to-t from-black/45 to-transparent pb-2 pt-6">
          <p className="text-[12px] font-bold text-white" data-testid="mockup-handle">{handle}</p>
          <MockCaption text={caption || "No caption."} max={FEED_CAPTION_CHARS} testId="mockup-caption" />
          <p className="flex items-center gap-1 text-[10px] text-white/90"><Music2 className="h-3 w-3" aria-hidden="true" />original sound - {account.name}</p>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[11%] items-center justify-around border-t border-white/10 bg-black text-[10px] font-semibold text-white/60">
          <span className="text-white">Home</span>
          <span>Friends</span>
          <span className="flex h-6 w-9 items-center justify-center rounded-md bg-white text-black"><Plus className="h-4 w-4" aria-hidden="true" /></span>
          <span>Inbox</span>
          <span>Profile</span>
        </div>

        {showSafeZones ? (
          <div className="pointer-events-none absolute inset-0" data-testid="tiktok-safe-zones" aria-hidden="true">
            <div className="absolute inset-x-0 top-0 h-[9%] border border-dashed border-sky-200/80 bg-sky-400/25 text-[9px] font-bold text-sky-100"><span className="m-1 inline-block">Top bar</span></div>
            <div className="absolute bottom-[11%] right-0 top-[38%] w-[22%] border border-dashed border-rose-200/80 bg-rose-500/25 text-[9px] font-bold text-rose-100"><span className="m-1 inline-block">Buttons</span></div>
            <div className="absolute bottom-[11%] left-0 right-[22%] h-[24%] border border-dashed border-amber-200/80 bg-amber-400/25 text-[9px] font-bold text-amber-100"><span className="m-1 inline-block">Caption</span></div>
            <div className="absolute inset-x-0 bottom-0 h-[11%] border border-dashed border-violet-200/80 bg-violet-500/25 text-[9px] font-bold text-violet-100"><span className="m-1 inline-block">Nav bar</span></div>
          </div>
        ) : null}
      </div>

      {isKnownNonVertical(media?.width, media?.height) ? (
        <p className="text-xs leading-5 text-warning" data-testid="tiktok-aspect-warning">This video isn&apos;t vertical, so TikTok will show it with black bars above and below.</p>
      ) : null}
    </div>
  );
}
