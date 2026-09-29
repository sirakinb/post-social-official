"use client";

import React from "react";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { ConnectedAccount, LibraryAsset, SelectedMedia, TikTokCreatorInfo, TikTokOptions, YouTubeOptions } from "@/lib/types";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { MediaDropZone } from "./media-drop-zone";
import { DestinationRail } from "./destination-rail";
import { TikTokPanel } from "./tiktok-panel";
import { YouTubePanel } from "./youtube-panel";
import { Input } from "../ui/input";

interface ComposerProps {
  accounts: ConnectedAccount[];
  tiktokCreatorInfo: TikTokCreatorInfo;
  initialCaption?: string;
  onSaveDraft?: (state: ComposerState) => void;
  onSchedule?: (state: ComposerState, scheduledAt: string) => void;
  onPublish?: (state: ComposerState) => void;
  busy?: boolean;
  uploadProgress?: number | null;
  libraryAssets?: LibraryAsset[];
  publishLabel?: string;
  onDeleteLibraryAsset?: (asset: LibraryAsset) => Promise<boolean>;
  deletingLibraryAssetId?: string | null;
}

export interface ComposerState {
  caption: string;
  files: SelectedMedia[];
  selectedDestinations: string[];
  tiktokOptions: TikTokOptions;
  youtubeOptions: YouTubeOptions;
  schedule: string;
  libraryAssetIds: string[];
  instagramCaption: string;
  facebookMessage: string;
  threadsText: string;
}

export function Composer({
  accounts,
  tiktokCreatorInfo,
  initialCaption = "",
  onSaveDraft,
  onSchedule,
  onPublish,
  busy = false,
  uploadProgress = null,
  libraryAssets = [],
  publishLabel = "Send to final approval",
  onDeleteLibraryAsset,
  deletingLibraryAssetId,
}: ComposerProps) {
  const [caption, setCaption] = React.useState(initialCaption);
  const [files, setFiles] = React.useState<SelectedMedia[]>([]);
  const [selectedDestinations, setSelectedDestinations] = React.useState<string[]>([]);
  const [schedule, setSchedule] = React.useState("");
  const [libraryAssetIds, setLibraryAssetIds] = React.useState<string[]>([]);
  const [instagramCaption, setInstagramCaption] = React.useState("");
  const [facebookMessage, setFacebookMessage] = React.useState("");
  const [threadsText, setThreadsText] = React.useState("");
  const [youtubeOptions, setYoutubeOptions] = React.useState<YouTubeOptions>({
    title: "",
    description: "",
    privacyStatus: "public",
  });
  const [tiktokOptions, setTiktokOptions] = React.useState<TikTokOptions>({
    privacyLevel: "",
    commentEnabled: false,
    duetEnabled: false,
    stitchEnabled: false,
    disclosureEnabled: false,
    yourBrandEnabled: false,
    brandedContentEnabled: false,
    aiGenerated: false,
  });

  const tiktokSelected = selectedDestinations.some(
    (id) => accounts.find((a) => a.id === id)?.platform === "tiktok"
  );
  const instagramSelected = selectedDestinations.some((id) => accounts.find((a) => a.id === id)?.platform === "instagram");
  const facebookSelected = selectedDestinations.some((id) => accounts.find((a) => a.id === id)?.platform === "facebook");
  const threadsSelected = selectedDestinations.some((id) => accounts.find((a) => a.id === id)?.platform === "threads");
  const youtubeSelected = selectedDestinations.some((id) => accounts.find((a) => a.id === id)?.platform === "youtube");

  const state: ComposerState = {
    caption,
    files,
    selectedDestinations,
    tiktokOptions,
    youtubeOptions,
    schedule,
    libraryAssetIds,
    instagramCaption,
    facebookMessage,
    threadsText,
  };

  const selectedLibraryAssets = libraryAssets.filter((asset) => libraryAssetIds.includes(asset.id));
  const selectedMediaTypes = [
    ...files.map((item) => item.file.type.startsWith("video/") ? "video" as const : "image" as const),
    ...selectedLibraryAssets.map((item) => item.mediaType),
  ];
  const tiktokErrors = tiktokSelected
    ? [...validateTikTokSelection(files, caption, tiktokCreatorInfo), ...validateTikTokLibrarySelection(selectedLibraryAssets, tiktokCreatorInfo)]
    : [];
  const facebookErrors = facebookSelected && selectedMediaTypes.length > 0
    ? selectedMediaTypes.length > 1
      ? ["Facebook image publishing accepts one image in this version."]
      : selectedMediaTypes[0] === "video"
        ? ["Facebook video publishing is not enabled in this version."]
        : []
    : [];
  const threadsErrors = threadsSelected
    ? validateThreadsSelection(files, selectedLibraryAssets, caption, threadsText)
    : [];
  const youtubeErrors = youtubeSelected
    ? validateYouTubeSelection(files, selectedLibraryAssets, caption, youtubeOptions)
    : [];
  const youtubeWarnings = youtubeSelected
    ? youtubeShortsWarnings(files, selectedLibraryAssets)
    : [];
  const selectedAccounts = selectedDestinations.map((id) => accounts.find((account) => account.id === id)).filter(Boolean);
  const mediaRequired = selectedAccounts.some((account) => account?.platform === "tiktok" || account?.platform === "instagram" || account?.platform === "youtube");
  const hasMedia = selectedMediaTypes.length > 0;

  const canPublish =
    caption.trim().length > 0 &&
    (!mediaRequired || hasMedia) &&
    selectedDestinations.length > 0 &&
    (!tiktokSelected || tiktokOptions.deliveryMode === "inbox" || tiktokOptions.privacyLevel !== "") &&
    tiktokErrors.length === 0 &&
    facebookErrors.length === 0 &&
    threadsErrors.length === 0 &&
    youtubeErrors.length === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        <div className="space-y-2">
          <label htmlFor="caption" className="text-sm font-medium text-ink">
            Caption
          </label>
          <Textarea
            id="caption"
            placeholder="Write something worth sharing..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            data-testid="composer-caption"
          />
          {tiktokSelected && (
            <p className={`text-xs ${caption.length > 2200 ? "text-error" : "text-ink-subtle"}`}>
              {caption.length.toLocaleString()} / 2,200 characters for TikTok
            </p>
          )}
        </div>

        <MediaDropZone files={files} onFilesChange={setFiles} />

        {libraryAssets.length > 0 && (
          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">Reuse from your library</p>
                <p className="mt-1 text-xs text-ink-subtle">Choose media you uploaded earlier.</p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">{libraryAssetIds.length} selected</span>
            </div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {libraryAssets.slice(0, 8).map((asset) => {
                const checked = libraryAssetIds.includes(asset.id);
                const deleting = deletingLibraryAssetId === asset.id;
                return (
                  <li key={asset.id} className="flex items-stretch gap-2">
                    <button
                      type="button"
                      aria-pressed={checked}
                      onClick={() => setLibraryAssetIds((current) => checked ? current.filter((id) => id !== asset.id) : [...current, asset.id])}
                      className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg border p-3 text-left transition ${checked ? "border-accent bg-accent-muted/55" : "border-border bg-canvas/40 hover:border-border-strong"}`}
                    >
                      {asset.url && asset.mediaType === "image" ? (
                        <Image unoptimized src={asset.url} alt="" width={40} height={40} className="h-10 w-10 rounded-md object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-raised text-[10px] font-bold uppercase text-accent">{asset.mediaType === "video" ? "VID" : "IMG"}</span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-ink">{asset.fileName}</span>
                        <span className="mt-1 block text-[10px] uppercase text-ink-subtle">{asset.mediaType}</span>
                      </span>
                    </button>
                    {onDeleteLibraryAsset && (
                      <Button
                        type="button"
                        variant="danger"
                        size="icon"
                        className="shrink-0 self-center"
                        aria-label={`Delete ${asset.fileName} from library`}
                        aria-busy={deleting}
                        disabled={deleting}
                        onClick={async () => {
                          if (!window.confirm(`Remove "${asset.fileName}" from your library? Unused files will be permanently deleted. Existing posts will be preserved.`)) return;
                          const success = await onDeleteLibraryAsset(asset);
                          if (success) {
                            setLibraryAssetIds((current) => current.filter((id) => id !== asset.id));
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="space-y-2">
          <label htmlFor="schedule" className="text-sm font-medium text-ink">
            Schedule (optional)
          </label>
          <Input
            id="schedule"
            type="datetime-local"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
          <p className="text-xs text-ink-subtle">
            Leave blank to publish now.
          </p>
        </div>
      </div>

      <div className="space-y-6 lg:col-span-5">
        <DestinationRail
          accounts={accounts}
          selected={selectedDestinations}
          onChange={setSelectedDestinations}
        />

        {(instagramSelected || facebookSelected || threadsSelected) && <section className="space-y-4 rounded-xl border border-border bg-surface p-4"><div><p className="text-sm font-semibold text-ink">Channel-specific wording</p><p className="mt-1 text-xs leading-5 text-ink-subtle">Optional. Leave blank to use the main caption.</p></div>{instagramSelected ? <div className="space-y-2"><label htmlFor="instagram-caption" className="text-xs font-semibold text-ink">Instagram caption</label><Textarea id="instagram-caption" rows={3} placeholder={caption || "Use the main caption"} value={instagramCaption} onChange={(event) => setInstagramCaption(event.target.value)} /></div> : null}{facebookSelected ? <div className="space-y-2"><label htmlFor="facebook-message" className="text-xs font-semibold text-ink">Facebook message</label><Textarea id="facebook-message" rows={3} placeholder={caption || "Use the main caption"} value={facebookMessage} onChange={(event) => setFacebookMessage(event.target.value)} /></div> : null}{threadsSelected ? <div className="space-y-2"><label htmlFor="threads-text" className="text-xs font-semibold text-ink">Threads text</label><Textarea id="threads-text" rows={3} placeholder={caption || "Use the main caption"} value={threadsText} onChange={(event) => setThreadsText(event.target.value)} data-testid="threads-text" />{threadsSelected && <p className={`text-xs ${(threadsText.trim() || caption).length > 500 ? "text-error" : "text-ink-subtle"}`}>{(threadsText.trim() || caption).length.toLocaleString()} / 500 characters for Threads</p>}</div> : null}</section>}

        {tiktokSelected && (
          <TikTokPanel
            creatorInfo={tiktokCreatorInfo}
            options={tiktokOptions}
            onChange={setTiktokOptions}
          />
        )}

        {youtubeSelected && (
          <YouTubePanel
            accountName={selectedAccounts.find((account) => account?.platform === "youtube")?.displayName ?? "YouTube channel"}
            options={youtubeOptions}
            onChange={setYoutubeOptions}
            fallbackTitle={caption}
            warnings={youtubeWarnings}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-5 lg:col-span-12 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-ink-subtle">
          {selectedDestinations.length === 0
            ? "Select at least one destination."
            : mediaRequired && !hasMedia
              ? "Add media before publishing or scheduling. You can still save this draft."
            : tiktokSelected && tiktokOptions.deliveryMode !== "inbox" && !tiktokOptions.privacyLevel
              ? "Choose a TikTok privacy setting before publishing."
            : tiktokErrors.length > 0
              ? tiktokErrors[0]
            : facebookErrors.length > 0
              ? facebookErrors[0]
            : threadsErrors.length > 0
              ? threadsErrors[0]
            : youtubeErrors.length > 0
              ? youtubeErrors[0]
              : "Ready when you are."}
        </p>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => onSaveDraft?.(state)}
            data-testid="save-draft" disabled={busy}
          >
            Save draft
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !canPublish || !schedule}
            onClick={() => onSchedule?.(state, schedule)}
            data-testid="schedule-post"
          >
            Schedule
          </Button>
          <Button
            variant="primary"
            disabled={busy || !canPublish}
            onClick={() => onPublish?.(state)}
            data-testid="publish-now"
          >
            {busy && uploadProgress != null
              ? `Uploading ${uploadProgress}%…`
              : busy
                ? "Saving…"
                : publishLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function validateTikTokLibrarySelection(media: LibraryAsset[], creatorInfo: TikTokCreatorInfo): string[] {
  const errors: string[] = [];
  for (const item of media) {
    if (item.sizeBytes > 1024 * 1024 * 1024) errors.push(`${item.fileName} is larger than TikTok's 1 GB limit.`);
    if (item.mediaType === "video" && !["video/mp4", "video/quicktime"].includes(item.mimeType)) errors.push(`${item.fileName} is not an MP4 or MOV video.`);
    if (item.durationSeconds !== undefined && item.durationSeconds > creatorInfo.maxVideoDurationSec) errors.push(`${item.fileName} is longer than this TikTok account allows.`);
  }
  return errors;
}

export function validateTikTokSelection(
  media: SelectedMedia[],
  caption: string,
  creatorInfo: TikTokCreatorInfo
): string[] {
  const errors: string[] = [];
  if (!creatorInfo.canPost) errors.push("TikTok says this account cannot post right now. Please try again later.");
  if (caption.length > 2200) errors.push("Shorten the TikTok caption to 2,200 characters or fewer.");
  for (const item of media) {
    if (item.file.size > 1024 * 1024 * 1024) errors.push(`${item.file.name} is larger than TikTok's 1 GB limit.`);
    if (item.file.type.startsWith("video/") && !["video/mp4", "video/quicktime"].includes(item.file.type)) {
      errors.push(`${item.file.name} is not an MP4 or MOV video.`);
    }
    if (item.durationSeconds !== undefined && item.durationSeconds > creatorInfo.maxVideoDurationSec) {
      errors.push(`${item.file.name} is longer than this TikTok account allows.`);
    }
  }
  return errors;
}

export function validateYouTubeSelection(
  files: SelectedMedia[],
  libraryAssets: LibraryAsset[],
  caption: string,
  options: YouTubeOptions
): string[] {
  const errors: string[] = [];
  const effectiveTitle = (options.title.trim() || caption).trim();
  if (!effectiveTitle) errors.push("Add a title (or caption) for the YouTube video.");
  if (effectiveTitle.length > 100) errors.push("Shorten the YouTube title to 100 characters or fewer.");
  if (options.description.length > 5000) errors.push("Shorten the YouTube description to 5,000 characters or fewer.");
  const videoCount = files.filter((item) => item.file.type.startsWith("video/")).length
    + libraryAssets.filter((item) => item.mediaType === "video").length;
  const totalMedia = files.length + libraryAssets.length;
  if (videoCount !== 1 || totalMedia !== 1) errors.push("A YouTube Short requires exactly one video file.");
  return errors;
}

export function youtubeShortsWarnings(
  files: SelectedMedia[],
  libraryAssets: LibraryAsset[]
): string[] {
  const warnings: string[] = [];
  const durations = [
    ...files.map((item) => item.durationSeconds),
    ...libraryAssets.map((item) => item.durationSeconds),
  ].filter((value): value is number => value !== undefined);
  if (durations.some((duration) => duration > 60)) {
    warnings.push("This video is longer than 60 seconds, so YouTube may publish it as a regular video instead of a Short.");
  }
  return warnings;
}

export function validateThreadsSelection(
  files: SelectedMedia[],
  libraryAssets: LibraryAsset[],
  caption: string,
  threadsText: string
): string[] {
  const errors: string[] = [];
  const effectiveText = (threadsText.trim() || caption).trim();
  if (effectiveText.length === 0) errors.push("Add text for Threads before publishing.");
  if (effectiveText.length > 500) errors.push("Shorten the Threads text to 500 characters or fewer.");

  const totalMedia = files.length + libraryAssets.length;
  if (totalMedia > 1) errors.push("Threads accepts one image in this version.");
  if (totalMedia === 1) {
    let isVideo: boolean;
    if (files.length === 1) {
      isVideo = files[0].file.type.startsWith("video/");
    } else {
      isVideo = libraryAssets[0].mediaType === "video";
    }
    if (isVideo) errors.push("Threads video publishing is not enabled in this version.");
  }
  return errors;
}
