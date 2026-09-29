"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { AccountAvatar } from "@/components/account-avatar";
import { CopyCaptionButton } from "@/components/copy-caption-button";
import { CaptionEditor } from "@/components/preview/caption-editor";
import { PlatformPreview } from "@/components/preview/platform-preview";
import { StatusIndicator } from "@/components/status-indicator";
import { useWorkspace } from "@/components/workspace-provider";
import { demoPosts, platformLabel } from "@/lib/demo";
import type { PostStatus } from "@/lib/types";
import { channelText, destinationProof, formatScheduleTime, isTikTokDraft, type ExtendedDestinationOptions } from "@/lib/post-preview";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { captionLimit, isCaptionEditable, planCaptionEdit } from "../../../../../convex/lib/captionEdit";
import type { ApprovalPolicy } from "../../../../../convex/lib/postState";

type Platform = "tiktok" | "instagram" | "facebook" | "threads" | "youtube";
type PreviewDestination = {
  key: string;
  platform: Platform;
  name: string;
  handle?: string;
  avatarUrl?: string;
  status: string;
  error?: string;
  liveUrl?: string;
  proof?: string;
  ownText?: { label: string; text: string };
  tiktokDraft: boolean;
};
type PreviewPost = {
  id: string;
  caption: string;
  status: string;
  scheduledAt?: number;
  policy: ApprovalPolicy;
  captionLimit: number;
  media: { fileName: string; mediaType: "image" | "video"; url?: string | null; width?: number; height?: number }[];
  destinations: PreviewDestination[];
};

const statusLabel: Record<string, string> = {
  draft: "Draft",
  awaiting_approval: "Waiting for approval",
  approved: "Approved",
  scheduled: "Scheduled",
  queued: "Queued",
  processing: "Processing",
  published: "Published",
  partially_published: "Partially published",
  failed: "Needs attention",
  cancelled: "Cancelled",
};

// The badge only knows six states; map every stored status onto one so an unfamiliar value can never crash the page.
function indicatorStatus(status: string): PostStatus {
  if (status === "published") return "published";
  if (status === "failed") return "failed";
  if (status === "partially_published") return "partial";
  if (status === "scheduled") return "scheduled";
  if (["processing", "uploading", "queued", "approved"].includes(status)) return "processing";
  return "draft";
}

export default function PostPreviewPage() {
  const params = useParams<{ id: string }>();
  const postId = params?.id;
  const workspace = useWorkspace();
  const live = workspace.mode === "live";
  const livePost = useQuery(api.posts.getForPreview, live && workspace.workspaceId && postId ? { workspaceId: workspace.workspaceId, postId } : "skip");
  const liveAccounts = useQuery(api.accounts.list, live && workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");

  const updateCaption = useMutation(api.posts.updateCaption);
  const [liveDraft, setLiveDraft] = useState<string | null>(null);
  const loading = live && (livePost === undefined || liveAccounts === undefined);
  const post: PreviewPost | undefined = live ? toLivePreview(livePost, liveAccounts) : toDemoPreview(postId);

  if (loading) return <p className="p-10 text-sm text-ink-muted" role="status">Loading preview…</p>;
  if (!post) {
    return (
      <div className="space-y-4 p-10">
        <p className="text-lg font-semibold text-ink">We couldn&apos;t find that post.</p>
        <p className="text-sm text-ink-muted">It may have been deleted, or it belongs to a different workspace.</p>
        <Link href="/app/calendar" className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover"><ArrowLeft className="h-4 w-4" />Back to the calendar</Link>
      </div>
    );
  }

  const willSendLater = post.status === "scheduled" || post.status === "approved";

  return (
    <div className="space-y-8 pb-10">
      <header className="stage-enter space-y-4">
        <Link href="/app/calendar" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Calendar</Link>
        <div>
          <p className="utility-label text-accent">Post Social / Preview</p>
          <h1 className="mt-3 text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em]">Post preview<span className="scanline-accent">.</span></h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-semibold text-ink" data-testid="preview-status">{statusLabel[post.status] ?? post.status.replaceAll("_", " ")}</span>
          {post.scheduledAt ? (
            <span className="inline-flex items-center gap-2 text-sm text-ink-muted" data-testid="preview-schedule"><CalendarClock className="h-4 w-4" />{formatScheduleTime(post.scheduledAt)}</span>
          ) : (
            <span className="text-sm text-ink-muted">Not scheduled</span>
          )}
        </div>
        {willSendLater ? <p className="text-xs text-ink-subtle">This is what will be sent. Nothing is published until the scheduled time.</p> : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_1fr]">
        <PlatformPreview
          media={post.media}
          caption={liveDraft ?? post.caption}
          channels={post.destinations.map((destination) => ({ key: destination.key, platform: destination.platform, name: destination.name, handle: destination.handle, avatarUrl: destination.avatarUrl, tiktokDraft: destination.tiktokDraft }))}
        />

        <div className="space-y-6">
          <CaptionEditor
            caption={post.caption}
            editable={live && isCaptionEditable(post.status)}
            willNeedReapproval={planCaptionEdit({ status: post.status, policy: post.policy, sending: false }).kind === "reapproval"}
            limit={post.captionLimit}
            onDraftChange={setLiveDraft}
            onSave={(next) => updateCaption({ workspaceId: workspace.workspaceId as Id<"workspaces">, postId: post.id as Id<"posts">, caption: next })}
          />

          <section className="grooved-surface space-y-4 rounded-xl border border-border bg-surface/95 p-6">
            <h2 className="text-sm font-bold uppercase tracking-[.18em] text-ink-subtle">Where it&apos;s going</h2>
            <ul className="divide-y divide-border">
              {post.destinations.map((destination) => (
                <li key={destination.key} className="space-y-2 py-4 first:pt-0 last:pb-0" data-testid="preview-destination">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AccountAvatar platform={destination.platform} src={destination.avatarUrl} name={destination.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{destination.name}</p>
                        <p className="text-xs text-ink-subtle">{platformLabel(destination.platform)}{destination.handle ? ` · ${destination.handle}` : ""}</p>
                      </div>
                    </div>
                    <StatusIndicator status={indicatorStatus(destination.status)} label={statusLabel[destination.status]} />
                  </div>
                  {destination.proof ? <p className="text-xs leading-5 text-ink-muted">{destination.proof}</p> : null}
                  {destination.tiktokDraft ? (
                    <p className="rounded-lg border border-accent/25 bg-accent-muted/35 p-3 text-xs leading-5 text-ink-muted" data-testid="preview-draft-note">TikTok can&apos;t receive a caption with a draft. Copy the caption above and paste it in TikTok when you finish the post.</p>
                  ) : null}
                  {destination.ownText ? (
                    <div className="space-y-2 rounded-lg border border-border bg-canvas p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-ink-muted">{destination.ownText.label}</p>
                        <CopyCaptionButton text={destination.ownText.text} label="Copy" />
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{destination.ownText.text}</p>
                    </div>
                  ) : null}
                  {destination.error ? <p className="text-xs text-warning">{destination.error}</p> : null}
                  {destination.liveUrl ? <a className="text-xs text-accent hover:text-accent-hover" href={destination.liveUrl} target="_blank" rel="noreferrer">Open live post ↗</a> : null}
                </li>
              ))}
              {post.destinations.length === 0 ? <li className="text-sm text-ink-muted">No destinations selected yet.</li> : null}
            </ul>
          </section>

          <p className="text-xs text-ink-subtle">To change a post, delete it from <Link href="/app/activity" className="text-accent hover:text-accent-hover">Activity</Link> and create it again.</p>
        </div>
      </div>
    </div>
  );
}

function toLivePreview(
  post: ReturnType<typeof useQuery<typeof api.posts.getForPreview>>,
  accounts: ReturnType<typeof useQuery<typeof api.accounts.list>>,
): PreviewPost | undefined {
  if (!post) return undefined;
  return {
    id: post._id,
    caption: post.caption,
    status: post.status,
    scheduledAt: post.scheduledAt,
    policy: post.effectiveApprovalPolicy,
    captionLimit: captionLimit(post.destinations),
    media: post.media.map((asset) => ({ fileName: asset.fileName, mediaType: asset.mediaType, url: asset.url, width: asset.width, height: asset.height })),
    destinations: post.destinations.map((destination) => {
      const account = accounts?.find((candidate) => candidate._id === destination.connectedAccountId);
      const options = destination.options as ExtendedDestinationOptions;
      const text = channelText(options, post.caption);
      const differs = Boolean(text) && text?.text !== post.caption;
      return {
        key: destination._id,
        platform: destination.platform,
        name: account?.displayName ?? platformLabel(destination.platform),
        handle: account?.handle,
        avatarUrl: account?.avatarUrl,
        status: destination.status,
        error: destination.sanitizedErrorMessage,
        liveUrl: destination.liveUrl,
        proof: destinationProof(options),
        ownText: differs ? text : undefined,
        tiktokDraft: isTikTokDraft(options),
      };
    }),
  };
}

function toDemoPreview(postId: string | undefined): PreviewPost | undefined {
  const post = demoPosts.find((candidate) => candidate.id === postId);
  if (!post) return undefined;
  return {
    id: post.id,
    caption: post.caption,
    status: post.status,
    scheduledAt: post.scheduledAt ? new Date(post.scheduledAt).getTime() : undefined,
    policy: "confirm_each",
    captionLimit: 2200,
    media: post.mediaUrl ? [{ fileName: "Sample media", mediaType: post.mediaType === "video" ? "video" : "image", url: post.mediaUrl }] : [],
    destinations: post.results.map((result) => ({
      key: `${post.id}-${result.accountId}`,
      platform: result.platform,
      name: platformLabel(result.platform),
      status: result.status,
      error: result.errorDetail,
      liveUrl: result.liveUrl,
      tiktokDraft: false,
    })),
  };
}
