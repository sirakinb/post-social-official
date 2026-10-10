"use client";

import { useState, type ReactNode } from "react";
import { PlatformMark } from "./ui";

// A profile photo that swaps to `fallback` if it won't load (a platform link that expired,
// a picture removed meanwhile), instead of the browser's broken-image icon.
export function AvatarImg({ src, className, style, fallback }: { src: string; className?: string; style?: React.CSSProperties; fallback: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- profile photos come from many hosts
  return <img src={src} alt="" className={className} style={style} onError={() => setFailed(src)} />;
}

// A connected account: its photo with a small platform badge, or just the platform's logo
// when there's no photo or it won't load.
export function AccountMark({ platform, avatarUrl, size, badge }: { platform: string; avatarUrl: string | null; size: number; badge: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!avatarUrl || failed === avatarUrl) return <PlatformMark platform={platform} size={size} className="rounded-full" />;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- profile photos come from many hosts */}
      <img src={avatarUrl} alt="" onError={() => setFailed(avatarUrl)} className="inline-flex flex-none overflow-hidden rounded-full border border-ps-line-strong object-cover" style={{ width: size, height: size }} />
      <PlatformMark platform={platform} size={badge} className="absolute -bottom-1 -right-1.5 rounded-[5px]" />
    </>
  );
}
