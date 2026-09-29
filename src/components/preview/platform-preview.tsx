"use client";

import Image from "next/image";
import { useState, type ComponentType } from "react";
import { platformLabel } from "@/lib/demo";
import { TikTokMockup } from "./tiktok-mockup";
import type { MockupMedia, MockupPlatform, MockupProps } from "./types";

export type PreviewChannel = { key: string; platform: MockupPlatform; name: string; handle?: string; avatarUrl?: string; tiktokDraft: boolean };

// One mockup per platform. To add Instagram, Threads, YouTube or Facebook, build a component
// that takes MockupProps and register it here; until then that tab shows the plain media.
const MOCKUPS: Partial<Record<MockupPlatform, ComponentType<MockupProps>>> = {
  tiktok: TikTokMockup,
};

function PlainMedia({ media, count }: { media?: MockupMedia; count: number }) {
  return (
    <div className="space-y-3">
      {media?.url ? (
        media.mediaType === "image" ? (
          <Image unoptimized src={media.url} alt={`Preview of ${media.fileName}`} width={720} height={1280} className="max-h-[70vh] w-full rounded-lg border border-border bg-canvas object-contain" />
        ) : (
          <video src={media.url} controls playsInline preload="metadata" aria-label={`Preview of ${media.fileName}`} className="max-h-[70vh] w-full rounded-lg border border-border bg-black" />
        )
      ) : (
        <div className="flex aspect-[9/16] max-h-[70vh] w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-ink-subtle">{media ? "This file is no longer available." : "No media attached."}</div>
      )}
      {media ? <p className="truncate text-xs text-ink-subtle">{media.fileName}{count > 1 ? ` + ${count - 1} more` : ""}</p> : null}
    </div>
  );
}

export function PlatformPreview({ media, channels, caption }: { media: MockupMedia[]; channels: PreviewChannel[]; caption: string }) {
  const platforms = Array.from(new Set(channels.map((channel) => channel.platform)));
  const firstWithMockup = platforms.find((platform) => MOCKUPS[platform]);
  const [tab, setTab] = useState<string>(firstWithMockup ?? "media");
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [accountKey, setAccountKey] = useState<string | null>(null);

  const tabs = [{ id: "media", label: "Media" }, ...platforms.map((platform) => ({ id: platform, label: platformLabel(platform) }))];
  const activePlatform = platforms.find((platform) => platform === tab);
  const candidates = channels.filter((channel) => channel.platform === activePlatform);
  const channel = candidates.find((candidate) => candidate.key === accountKey) ?? candidates[0];
  const Mockup = activePlatform ? MOCKUPS[activePlatform] : undefined;

  return (
    <section aria-label="Media preview" className="space-y-4">
      <div role="tablist" aria-label="Preview as" className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" id={`preview-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="preview-panel" onClick={() => setTab(item.id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${tab === item.id ? "border-accent bg-accent text-white" : "border-border bg-surface text-ink-muted hover:text-ink"}`}>{item.label}</button>
        ))}
      </div>

      <div role="tabpanel" id="preview-panel" aria-labelledby={`preview-tab-${tab}`} className="space-y-3">
        {Mockup && channel ? (
          <>
            {candidates.length > 1 ? (
              <label className="flex items-center gap-2 text-xs text-ink-muted">Preview as
                <select value={channel.key} onChange={(event) => setAccountKey(event.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink">
                  {candidates.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.name}</option>)}
                </select>
              </label>
            ) : null}
            <Mockup media={media[0]} caption={caption} account={{ name: channel.name, handle: channel.handle, avatarUrl: channel.avatarUrl }} showSafeZones={showSafeZones} />
            <label className="mx-auto flex max-w-[300px] items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" checked={showSafeZones} onChange={(event) => setShowSafeZones(event.target.checked)} data-testid="toggle-safe-zones" />
              Show where {platformLabel(channel.platform)}&apos;s buttons and text cover the video
            </label>
            {channel.tiktokDraft ? <p className="mx-auto max-w-[300px] text-xs leading-5 text-ink-subtle">This is a draft: you&apos;ll paste the caption in TikTok yourself, so this shows how it will look once you do.</p> : null}
            <p className="mx-auto max-w-[300px] text-[11px] leading-4 text-ink-subtle">An approximation of the app&apos;s layout. Real counts, sounds and updates to the app aren&apos;t shown.</p>
          </>
        ) : activePlatform ? (
          <>
            <p className="text-xs leading-5 text-ink-subtle" data-testid="no-mockup-note">A {platformLabel(activePlatform)} mockup isn&apos;t available yet. Here is the media as it will be sent.</p>
            <PlainMedia media={media[0]} count={media.length} />
          </>
        ) : (
          <PlainMedia media={media[0]} count={media.length} />
        )}
      </div>
    </section>
  );
}
