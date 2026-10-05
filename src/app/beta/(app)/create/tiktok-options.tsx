"use client";

import type { CreatorInfo } from "../../../../../backend/lib/connections/tiktok-creator";
import { TIKTOK_PRIVACY_LABELS, tiktokLabel, type TikTokChoice } from "@/lib/beta/composer-model";
import { cn } from "@/lib/utils";

// TikTok's posting options, built to its content sharing guidelines: the creator's
// nickname, an audience with no default, interactions off by default (greyed out when the
// creator turned them off), and the commercial content disclosure with its labels.
export function TikTokOptions({ value, onChange, info, infoError, accountName, photo }: { value: TikTokChoice; onChange: (v: TikTokChoice) => void; info: CreatorInfo | null; infoError: string | null; accountName: string; photo: boolean }) {
  const set = (change: Partial<TikTokChoice>) => onChange({ ...value, ...change });
  const label = tiktokLabel(value, photo);
  // Photo posts can't be duetted or stitched; TikTok only offers comments for them.
  const interactions = ([
    ["comments", "Comment", info?.comment_disabled],
    ["duet", "Duet", info?.duet_disabled],
    ["stitch", "Stitch", info?.stitch_disabled],
  ] as const).filter(([key]) => !photo || key === "comments");
  return (
    <div className="flex flex-col gap-3">
      <div className="text-ps-muted">
        Posting {photo ? "a photo post" : "a video"} to <span className="text-ps-text">{info?.nickname ?? accountName}</span> on TikTok
      </div>
      {photo && (
        <label className="flex flex-col gap-1.5">
          <span className="flex justify-between text-xs text-ps-muted">Title (optional) <span className="font-mono">{(value.title ?? "").length} / 90</span></span>
          <input id="tiktok-photo-title" value={value.title ?? ""} maxLength={90} placeholder="Shown above the caption" onChange={(e) => set({ title: e.target.value })} className="h-9 rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px]" />
        </label>
      )}
      <div className="inline-flex self-start rounded-[9px] border border-white/[0.08] bg-ps-ground p-[3px]" role="radiogroup" aria-label="How to send it">
        {(
          [
            ["inbox", "Send to TikTok inbox"],
            ["direct", "Post directly"],
          ] as const
        ).map(([mode, text]) => (
          <button key={mode} type="button" role="radio" aria-checked={value.mode === mode} onClick={() => set({ mode })} className={cn("h-7 rounded-md px-3 text-xs", value.mode === mode ? "bg-[#2A2142] text-ps-text" : "text-ps-muted hover:text-ps-text")}>
            {text}
          </button>
        ))}
      </div>

      {value.mode === "inbox" ? (
        <p className="m-0 text-xs leading-relaxed text-ps-muted">The {photo ? "photos land" : "video lands"} in your TikTok inbox. Open TikTok, add any sound or effects, and tap Post when you&apos;re ready.</p>
      ) : infoError ? (
        <p role="alert" className="m-0 text-xs text-[#FF8A8E]">{infoError}</p>
      ) : !info ? (
        <p className="m-0 text-xs text-ps-subtle">Loading this account&apos;s TikTok settings…</p>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-ps-muted">Who can watch this video</span>
            <select value={value.privacyLevel} onChange={(e) => set({ privacyLevel: e.target.value })} className="h-9 rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px] text-ps-text">
              <option value="" disabled>Choose an audience</option>
              {info.privacy_level_options.map((p) => {
                const blocked = p === "SELF_ONLY" && value.disclose && value.brandedContent;
                return (
                  <option key={p} value={p} disabled={blocked}>
                    {TIKTOK_PRIVACY_LABELS[p] ?? p}{blocked ? " (not for branded content)" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          <fieldset className="m-0 flex flex-wrap gap-x-5 gap-y-2 border-0 p-0">
            <legend className="mb-1.5 text-xs text-ps-muted">Allow viewers to</legend>
            {interactions.map(([key, text, off]) => (
              <label key={key} className={cn("flex items-center gap-2", off && "opacity-50")} title={off ? `${text} is turned off in this TikTok account's settings` : undefined}>
                <input type="checkbox" checked={!off && value[key]} disabled={off} onChange={(e) => set({ [key]: e.target.checked } as Partial<TikTokChoice>)} className="h-4 w-4 accent-[#9B6CFF]" />
                {text}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] p-3">
            <label className="flex items-center justify-between gap-3">
              <span>
                Disclose video content
                <span className="block text-xs text-ps-subtle">Turn on if this {photo ? "post" : "video"} promotes yourself, a brand, product or service.</span>
              </span>
              <input type="checkbox" role="switch" checked={value.disclose} onChange={(e) => set({ disclose: e.target.checked, yourBrand: false, brandedContent: false })} className="h-4 w-4 accent-[#9B6CFF]" />
            </label>
            {value.disclose && (
              <div className="flex flex-col gap-2 pl-1">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={value.yourBrand} onChange={(e) => set({ yourBrand: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[#9B6CFF]" />
                  <span>Your brand<span className="block text-xs text-ps-subtle">You&apos;re promoting yourself or your own business.</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={value.brandedContent} onChange={(e) => set({ brandedContent: e.target.checked, ...(e.target.checked && value.privacyLevel === "SELF_ONLY" ? { privacyLevel: "" } : {}) })} className="mt-0.5 h-4 w-4 accent-[#9B6CFF]" />
                  <span>Branded content<span className="block text-xs text-ps-subtle">You&apos;re promoting another brand or a third party.</span></span>
                </label>
                {label && <p className="m-0 text-xs text-ps-plum-soft">{label}</p>}
              </div>
            )}
          </div>
        </>
      )}

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.aiGenerated} onChange={(e) => set({ aiGenerated: e.target.checked })} className="h-4 w-4 accent-[#9B6CFF]" />
        Label as AI-generated content
      </label>
    </div>
  );
}

// The consent line TikTok requires next to the Post button.
export function TikTokConsent({ brandedContent }: { brandedContent: boolean }) {
  return (
    <p className="m-0 text-xs text-ps-muted">
      By posting, you agree to TikTok&apos;s{" "}
      {brandedContent && (
        <>
          <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="text-ps-plum-soft hover:text-ps-text">Branded Content Policy</a> and{" "}
        </>
      )}
      <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="text-ps-plum-soft hover:text-ps-text">Music Usage Confirmation</a>.
    </p>
  );
}
