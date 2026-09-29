"use client";

import { Check, Clock3, Trash2, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { demoPosts } from "@/lib/demo";
import { useMutation, useQuery } from "convex/react";
import { useWorkspace } from "@/components/workspace-provider";
import { friendlyErrorMessage } from "@/lib/error-message";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { platformLabel } from "@/lib/demo";
import type { Doc } from "../../../../convex/_generated/dataModel";

type DestinationOptions = Doc<"destinations">["options"];
type ThreadsDestinationOptions = { kind: "threads"; mediaType: "text" | "image"; text?: string };
type ExtendedDestinationOptions = DestinationOptions | ThreadsDestinationOptions;

function destinationProof(options: ExtendedDestinationOptions | undefined) {
  if (!options) return undefined;
  if (options.kind === "tiktok") {
    const privacy = options.privacyLevel.toLowerCase().replaceAll("_", " ");
    const interactions = [options.commentEnabled ? "Comments on" : "Comments off", options.duetEnabled ? "Duet on" : "Duet off", options.stitchEnabled ? "Stitch on" : "Stitch off"];
    const disclosure = options.disclosureEnabled
      ? [options.yourBrandEnabled ? "Your brand" : "", options.brandedContentEnabled ? "Branded content" : "", options.aiGenerated ? "AI-generated" : ""].filter(Boolean).join(", ") || "Disclosure enabled"
      : "No content disclosure";
    return `${privacy} · ${interactions.join(" · ")} · ${disclosure}`;
  }
  if (options.kind === "instagram") return `${options.mediaType === "reel" ? "Reel" : options.mediaType === "carousel" ? "Carousel" : "Image"} · ${options.caption ? "Custom Instagram caption" : "Shared caption"}`;
  if (options.kind === "threads") return options.mediaType === "image" ? "Image post" : "Text post";
  if (options.kind === "youtube") return `Short · ${options.privacyStatus} · ${options.description ? "Custom YouTube description" : "Shared caption"}`;
  return `${options.mediaType === "feed" ? "Text feed post" : "Image post"} · ${options.message ? "Custom Facebook message" : "Shared caption"}`;
}

const statusLook = {
  published: { icon: Check, label: "Published", color: "bg-[#55D6A5]", copy: "Every destination confirmed the post is live." },
  scheduled: { icon: Clock3, label: "Scheduled", color: "bg-accent", copy: "Approved and waiting for its publishing time." },
  failed: { icon: TriangleAlert, label: "Needs attention", color: "bg-[#FFB84D]", copy: "One destination needs a closer look before retrying." },
  draft: { icon: Clock3, label: "Draft", color: "bg-ink-subtle", copy: "Still being prepared." },
  processing: { icon: Clock3, label: "Processing", color: "bg-accent", copy: "The platforms are processing this post." },
  partial: { icon: TriangleAlert, label: "Partially published", color: "bg-[#FFB84D]", copy: "Some destinations succeeded and one needs attention." },
} as const;

export default function ActivityPage() {
  const workspace = useWorkspace();
  const livePosts = useQuery(api.posts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const decideApproval = useMutation(api.posts.decideApproval);
  const deleteUnpublished = useMutation(api.posts.deleteUnpublished);
  const [busyPost, setBusyPost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const posts = workspace.mode === "live" ? (livePosts ?? []).map(post => ({ id: post._id, caption: post.caption, status: post.status, scheduledAt: post.scheduledAt, channels: post.destinations.map(destination => destination.platform), media: post.media.map((asset) => ({ fileName: asset.fileName, mediaType: asset.mediaType, url: asset.url })), results: post.destinations.map(destination => ({ platform: destination.platform, status: destination.status, liveUrl: destination.liveUrl, error: destination.sanitizedErrorMessage, proof: destinationProof(destination.options as ExtendedDestinationOptions) })) })) : demoPosts.map(post => ({ ...post, channels: post.results.map(result => result.platform), media: post.mediaUrl ? [{ fileName: "Sample media", mediaType: post.mediaType === "video" ? "video" as const : "image" as const, url: post.mediaUrl }] : [], results: post.results.map(result => ({ platform: result.platform, status: result.status, liveUrl: result.liveUrl, error: result.errorDetail, proof: undefined })) }));
  const completed = posts.filter((post) => ["published", "partially_published", "failed"].includes(post.status));
  const successRate = completed.length ? `${Math.round(completed.filter((post) => post.status === "published").length / completed.length * 100)}%` : "—";

  function lookFor(status: string) {
    if (status === "awaiting_approval") return { icon: Clock3, label: "Waiting for approval", color: "bg-warning", copy: "Review the final post and choose whether it can publish." };
    if (status === "published") return statusLook.published;
    if (status === "scheduled") return statusLook.scheduled;
    if (["failed", "partially_published"].includes(status)) return statusLook.failed;
    if (["processing", "approved"].includes(status)) return statusLook.processing;
    return statusLook.draft;
  }

  async function decide(postId: string, decision: "approved" | "rejected") {
    if (!workspace.workspaceId) return;
    setBusyPost(postId); setError(null);
    try { await decideApproval({ workspaceId: workspace.workspaceId, postId: postId as Id<"posts">, decision }); }
    catch (cause) { setError(friendlyErrorMessage(cause, "The approval decision could not be saved.")); }
    finally { setBusyPost(null); }
  }

  async function remove(postId: string) {
    if (!workspace.workspaceId || !window.confirm("Delete this unpublished post and its stored media?")) return;
    setBusyPost(postId); setError(null);
    try { await deleteUnpublished({ workspaceId: workspace.workspaceId, postId: postId as Id<"posts"> }); }
    catch (cause) { setError(friendlyErrorMessage(cause, "The post could not be deleted.")); }
    finally { setBusyPost(null); }
  }
  return (
    <div className="space-y-10 pb-10">
      <header className="stage-enter grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div><p className="utility-label text-accent">Post Social / Publishing log</p><h1 className="mt-3 text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em]">Activity<span className="scanline-accent">.</span></h1><p className="mt-5 max-w-xl text-base leading-7 text-ink-muted">A plain-English record of what published, where it went, and what needs you next.</p></div>
        <div className="grooved-surface rounded-xl border border-border bg-surface-raised p-6 text-white"><p className="utility-label text-ink-subtle">Current history</p><p className="mt-2 text-4xl font-semibold tracking-[-0.07em]">{successRate}</p><p className="mt-1 text-sm text-ink-muted">confirmed live without a failure</p></div>
      </header>
      {error ? <p role="alert" className="rounded-xl border border-error/30 bg-error-bg p-4 text-sm text-error">{error}</p> : null}
      <section className="grooved-surface stage-enter-delayed overflow-hidden rounded-xl border border-border bg-surface/95">
        <div className="hidden border-b border-border px-6 py-4 text-xs font-bold uppercase tracking-[.18em] text-ink-subtle lg:grid lg:grid-cols-[120px_1fr_180px]"><span>Moment</span><span>Story</span><span>Status</span></div>
        <div className="divide-y divide-border">{posts.map((post,index) => { const look=lookFor(post.status); const Icon=look.icon; const canDelete = workspace.mode === "live" && ["draft", "awaiting_approval", "approved", "scheduled", "failed", "cancelled"].includes(post.status); const media = post.media[0]; return <article key={post.id} className="grid gap-5 px-6 py-7 transition hover:bg-canvas lg:grid-cols-[120px_1fr_240px] lg:items-start"><div><p className="text-sm font-bold">{index ? "Earlier" : "Latest"}</p><p className="mt-1 text-xs text-ink-subtle">{index ? "Saved" : "Just now"}</p></div><div>{post.status === "awaiting_approval" && media?.url ? media.mediaType === "image" ? <Image unoptimized src={media.url} alt={`Final proof for ${media.fileName}`} width={900} height={600} className="mb-5 max-h-72 w-full rounded-lg border border-border object-contain bg-canvas" /> : <video src={media.url} controls preload="metadata" aria-label={`Final proof for ${media.fileName}`} className="mb-5 max-h-72 w-full rounded-lg border border-border bg-black" /> : null}<h2 className="text-xl font-semibold">{post.caption || "Untitled post"}</h2><p className="mt-2 text-sm text-ink-muted">{look.copy}</p>{post.status === "awaiting_approval" ? <p className="mt-3 rounded-lg border border-accent/25 bg-accent-muted/35 p-3 text-xs leading-5 text-ink-muted">This is the final proof. Approving records your decision, these destinations and settings, and the current time before publishing begins.</p> : null}<ul className="mt-4 space-y-3">{post.results.map((result) => <li key={`${post.id}-${result.platform}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className="font-semibold text-ink">{platformLabel(result.platform)}</span><span className="text-ink-subtle">{result.status.replaceAll("_", " ")}</span>{result.liveUrl ? <a className="text-accent hover:text-accent-hover" href={result.liveUrl} target="_blank" rel="noreferrer">Open live post ↗</a> : null}{result.proof ? <span className="w-full leading-5 text-ink-muted">{result.proof}</span> : null}{result.error ? <span className="w-full text-warning">{result.error}</span> : null}</li>)}</ul>{post.scheduledAt ? <p className="mt-4 text-xs text-ink-subtle">Scheduled for {new Date(post.scheduledAt).toLocaleString()}</p> : null}</div><div className="flex flex-wrap items-center gap-2">{post.status === "awaiting_approval" && workspace.mode === "live" ? <><Button size="sm" variant="primary" disabled={busyPost === post.id} onClick={() => decide(post.id, "approved")}>{busyPost === post.id ? "Saving…" : "Approve & publish"}</Button><Button size="sm" variant="secondary" disabled={busyPost === post.id} onClick={() => decide(post.id, "rejected")}>Return</Button></> : <div className="mr-2 flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-full ${look.color} text-white`}><Icon className="h-4 w-4" /></span><span className="text-sm font-bold">{look.label}</span></div>}{canDelete ? <Button size="sm" variant="danger" disabled={busyPost === post.id} onClick={() => remove(post.id)}><Trash2 className="h-4 w-4" />{busyPost === post.id ? "Deleting…" : "Delete"}</Button> : null}</div></article>; })}{posts.length === 0 && <div className="p-10 text-center"><p className="font-medium">No publishing activity yet.</p><p className="mt-2 text-sm text-ink-muted">Your drafts, approvals, and results will appear here.</p></div>}</div>
      </section>
    </div>
  );
}
