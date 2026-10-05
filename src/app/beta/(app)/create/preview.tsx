"use client";

import { ActorMark } from "@/components/beta/marks";
import { PlatformMark } from "@/components/beta/ui";
import type { ComposerAccount, ComposerMedia } from "@/lib/beta/composer-model";
import { NAMES } from "@/lib/beta/composer-model";

// How the post will look, with the person's real handle, photo and media. Feeds trim
// long captions differently, so the preview shows the start of the caption the way the
// platform does.
export function Preview({ account, media, caption, mediaType, title }: { account: ComposerAccount; media: ComposerMedia[]; caption: string; mediaType?: string; title?: string }) {
  const first = media[0] ?? null;
  const fullBleed = (account.platform === "instagram" && mediaType === "reel") || account.platform === "tiktok" || account.platform === "youtube" || (account.platform === "facebook" && mediaType === "reel");
  const author = (
    <div className="flex items-center gap-2">
      <ActorMark kind="user" name={account.name} avatarUrl={account.avatarUrl} size={26} />
      <span className="text-xs font-semibold">{account.platform === "youtube" ? account.name : account.handle}</span>
    </div>
  );

  return (
    <div className="h-[620px] w-[300px] rounded-[40px] border border-white/[0.12] bg-[#050309] p-2.5 shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
      <div className="relative h-full w-full overflow-hidden rounded-[31px] bg-[#0A0A0F] text-white">
        {fullBleed ? (
          <>
            <MediaView media={first} cover className="absolute inset-0 h-full w-full" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
            <div className="absolute inset-x-0 top-0 flex justify-between px-4 pt-5 text-[13px] font-semibold">
              <span>{account.platform === "youtube" ? "Shorts" : account.platform === "tiktok" ? "For You" : "Reels"}</span>
              <PlatformMark platform={account.platform} size={22} className="border-white/20 bg-black/30" />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 px-4 pb-5">
              {author}
              {account.platform === "youtube" && title && <p className="m-0 text-xs font-semibold leading-snug">{title}</p>}
              <p className="m-0 line-clamp-3 text-xs leading-snug text-white/90">{account.platform === "youtube" ? "" : caption}</p>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-4 pb-2 pt-6">
              <span className="text-[13px] font-semibold">{NAMES[account.platform]}</span>
              <PlatformMark platform={account.platform} size={22} />
            </div>
            <div className="flex flex-col gap-2.5 px-3.5">
              {author}
              {account.platform !== "instagram" && <p className="m-0 line-clamp-6 whitespace-pre-line text-[12.5px] leading-snug text-white/90">{caption || <span className="text-white/40">Your caption shows here</span>}</p>}
            </div>
            {first && (
              <div className="mt-3 px-3.5">
                <MediaView media={first} className={`w-full rounded-xl ${account.platform === "instagram" ? "aspect-[4/5]" : "max-h-[300px]"} object-cover`} />
                {media.length > 1 && <div className="mt-2 flex justify-center gap-1">{media.map((m, i) => <span key={m.id} className={`h-1.5 w-1.5 rounded-full ${i ? "bg-white/30" : "bg-white"}`} />)}</div>}
              </div>
            )}
            {account.platform === "instagram" && (
              <p className="m-0 mt-3 line-clamp-4 px-3.5 text-[12.5px] leading-snug text-white/90">
                <strong className="font-semibold">{account.handle}</strong> {caption}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaView({ media, className, cover }: { media: ComposerMedia | null; className?: string; cover?: boolean }) {
  if (!media) return <div className={`${className} bg-gradient-to-b from-[#2A2142] to-[#0A0A0F]`} />;
  if (!media.url) return <div className={`${className} flex items-center justify-center bg-[#1A1430] text-xs text-white/50`}>{media.name}</div>;
  if (media.type === "video") {
    return <video src={media.url} poster={media.poster ?? undefined} className={`${className} ${cover ? "object-cover" : ""}`} muted loop playsInline autoPlay preload="metadata" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- signed link to private storage
  return <img src={media.url} alt="" className={`${className} ${cover ? "object-cover" : ""}`} />;
}
