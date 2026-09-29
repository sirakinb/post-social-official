"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { Composer, ComposerState } from "@/components/composer/composer";
import { demoAccounts, demoTikTokCreator } from "@/lib/demo";
import type { ConnectedAccount, LibraryAsset, TikTokCreatorInfo } from "@/lib/types";
import { useWorkspace } from "@/components/workspace-provider";
import { friendlyErrorMessage } from "@/lib/error-message";
import { mediaRemovalMessage } from "@/lib/media-removal-message";
import { assertFilesWithinSizeLimit, uploadFile } from "@/lib/uploadMedia";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const unavailableTikTokInfo: TikTokCreatorInfo = {
  creatorId: "",
  nickname: "TikTok account",
  privacyLevelOptions: [],
  commentAvailable: false,
  duetAvailable: false,
  stitchAvailable: false,
  maxVideoDurationSec: 0,
  canPost: false,
};

export default function CreatePage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const liveAccounts = useQuery(api.accounts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const liveMedia = useQuery(api.media.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const saveUploaded = useMutation(api.media.saveUploaded);
  const deleteUnused = useMutation(api.media.deleteUnused);
  const createDraft = useMutation(api.posts.createDraft);
  const requestPublish = useMutation(api.posts.requestPublish);
  const fetchTikTokInfo = useAction(api.platformAccounts.getTikTokCreatorInfo);
  const [loadedTikTokInfo, setLoadedTikTokInfo] = useState<{ accountId: string; info: TikTokCreatorInfo; checkedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingLibraryAssetId, setDeletingLibraryAssetId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const accounts: ConnectedAccount[] = useMemo(() => workspace.mode === "live" ? (liveAccounts ?? []).map(account => ({ id: account._id, platform: account.platform, handle: account.handle, displayName: account.displayName, avatarUrl: account.avatarUrl, health: account.health, healthReason: account.healthReason })) : demoAccounts, [liveAccounts, workspace.mode]);
  const tiktokAccount = liveAccounts?.find(account => account.platform === "tiktok" && account.health === "connected");
  const loadedTikTokMatches = Boolean(tiktokAccount && loadedTikTokInfo?.accountId === tiktokAccount._id);
  const tiktokInfo = workspace.mode === "live"
    ? loadedTikTokMatches
      ? loadedTikTokInfo!.info
      : { ...unavailableTikTokInfo, creatorId: tiktokAccount?.externalAccountId ?? "", nickname: tiktokAccount?.displayName ?? "TikTok account" }
    : demoTikTokCreator;
  const creatorCheckedAt = workspace.mode === "live" && loadedTikTokMatches ? loadedTikTokInfo!.checkedAt : 0;
  const approvalCopy = workspace.approvalPolicy === "autonomous"
    ? { title: "Autonomous publishing is on.", body: "Approved automations can publish without another prompt. Every action stays in Activity.", button: "Publish now" }
    : workspace.approvalPolicy === "approve_after_draft"
      ? { title: "Approve the prepared draft once.", body: "After approval, Post Social will publish it at the selected time.", button: "Request draft approval" }
      : { title: "Nothing publishes by surprise.", body: "You will review the final proof before delivery begins.", button: "Send to final approval" };

  useEffect(() => {
    if (!workspace.workspaceId || !tiktokAccount) return;
    let cancelled = false;
    void fetchTikTokInfo({ workspaceId: workspace.workspaceId, accountId: tiktokAccount._id })
      .then((info) => {
        if (!cancelled) {
          setLoadedTikTokInfo({ accountId: tiktokAccount._id, info, checkedAt: info.checkedAt });
          setMessage(null);
        }
      })
      .catch((cause) => {
        if (!cancelled) setMessage({ kind: "error", text: friendlyErrorMessage(cause, "TikTok account options could not be refreshed.") });
      });
    return () => { cancelled = true; };
  }, [fetchTikTokInfo, tiktokAccount, workspace.workspaceId]);

  async function uploadFiles(state: ComposerState) {
    if (!workspace.workspaceId) throw new Error("Sign in to save a real post.");
    const filesToUpload = state.files.map(({ file }) => file);
    assertFilesWithinSizeLimit(filesToUpload);
    if (state.files.length === 0) return [];

    const totalBytes = filesToUpload.reduce((sum, file) => sum + file.size, 0);
    const loadedByFile = new Array(state.files.length).fill(0) as number[];
    setUploadProgress(0);

    try {
      return await Promise.all(state.files.map(async ({ file, durationSeconds }, index) => {
        const uploadUrl = await generateUploadUrl({ workspaceId: workspace.workspaceId! });
        const { storageId } = await uploadFile({
          uploadUrl,
          file,
          onProgress: ({ loaded }) => {
            loadedByFile[index] = loaded;
            const totalLoaded = loadedByFile.reduce((sum, value) => sum + value, 0);
            const percent = totalBytes > 0 ? Math.round((totalLoaded / totalBytes) * 100) : 0;
            setUploadProgress(percent);
          },
        });
        return await saveUploaded({ workspaceId: workspace.workspaceId!, storageId: storageId as Id<"_storage">, fileName: file.name, mimeType: file.type, mediaType: file.type.startsWith("video/") ? "video" : "image", sizeBytes: file.size, durationSeconds });
      }));
    } finally {
      setUploadProgress(null);
    }
  }

  function destinationsFor(state: ComposerState) {
    return state.selectedDestinations.map(id => {
      const account = accounts.find(item => item.id === id); if (!account) throw new Error("A selected account is unavailable.");
      const connectedAccountId = id as Id<"connectedAccounts">;
      if (account.platform === "youtube") return { connectedAccountId, options: { kind: "youtube" as const, title: state.youtubeOptions.title.trim() || state.caption, description: state.youtubeOptions.description.trim() || state.caption, privacyStatus: state.youtubeOptions.privacyStatus } };
      if (account.platform === "tiktok") return { connectedAccountId, options: { kind: "tiktok" as const, privacyLevel: state.tiktokOptions.privacyLevel, commentEnabled: state.tiktokOptions.commentEnabled, duetEnabled: state.tiktokOptions.duetEnabled, stitchEnabled: state.tiktokOptions.stitchEnabled, disclosureEnabled: state.tiktokOptions.disclosureEnabled, yourBrandEnabled: state.tiktokOptions.yourBrandEnabled, brandedContentEnabled: state.tiktokOptions.brandedContentEnabled, aiGenerated: state.tiktokOptions.aiGenerated, deliveryMode: state.tiktokOptions.deliveryMode, creatorInfoCheckedAt: creatorCheckedAt, creatorInfoSnapshot: { nickname: tiktokInfo.nickname, maxVideoDurationSec: tiktokInfo.maxVideoDurationSec, canPost: tiktokInfo.canPost, privacyLevelOptions: tiktokInfo.privacyLevelOptions.map((option) => option.value), commentAvailable: tiktokInfo.commentAvailable, duetAvailable: tiktokInfo.duetAvailable, stitchAvailable: tiktokInfo.stitchAvailable } } };
      const selectedLibrary = (liveMedia ?? []).filter((asset) => state.libraryAssetIds.includes(asset._id));
      const totalMedia = state.files.length + selectedLibrary.length;
      const firstIsVideo = state.files[0]?.file.type.startsWith("video/") ?? selectedLibrary[0]?.mediaType === "video";
      if (account.platform === "instagram") return { connectedAccountId, options: { kind: "instagram" as const, mediaType: totalMedia > 1 ? "carousel" as const : firstIsVideo ? "reel" as const : "image" as const, caption: state.instagramCaption.trim() || state.caption } };
      if (account.platform === "threads") return { connectedAccountId, options: { kind: "threads" as const, mediaType: totalMedia === 0 ? "text" as const : "image" as const, text: state.threadsText.trim() || state.caption } };
      return { connectedAccountId, options: { kind: "facebook" as const, mediaType: firstIsVideo ? "video" as const : totalMedia ? "image" as const : "feed" as const, message: state.facebookMessage.trim() || state.caption } };
    });
  }

  async function save(state: ComposerState, publish: boolean, scheduledAt?: string) {
    if (!workspace.workspaceId) { router.push("/login"); return; }
    setBusy(true); setMessage(null);
    try {
      const mediaAssetIds = [...state.libraryAssetIds.map((id) => id as Id<"mediaAssets">), ...await uploadFiles(state)];
      const postId = await createDraft({ workspaceId: workspace.workspaceId, caption: state.caption, mediaAssetIds, scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : undefined, entryPoint: "ui", destinations: destinationsFor(state) as Parameters<typeof createDraft>[0]["destinations"] });
      if (publish) { const result = await requestPublish({ workspaceId: workspace.workspaceId, postId, consented: true }); setMessage({ kind: "success", text: result.status === "awaiting_approval" ? "Draft saved and ready for your approval." : "Post queued for publishing." }); router.push("/app/activity"); }
      else setMessage({ kind: "success", text: "Draft saved safely." });
    } catch (cause) { setMessage({ kind: "error", text: friendlyErrorMessage(cause, "The post could not be saved.") }); }
    finally { setBusy(false); }
  }

  async function handleDeleteLibraryAsset(asset: LibraryAsset): Promise<boolean> {
    if (!workspace.workspaceId) return false;
    setDeletingLibraryAssetId(asset.id);
    setMessage(null);
    try {
      const result = await deleteUnused({ workspaceId: workspace.workspaceId, mediaId: asset.id as Id<"mediaAssets"> });
      setMessage({ kind: "success", text: mediaRemovalMessage(result) });
      return true;
    } catch (cause) {
      setMessage({ kind: "error", text: friendlyErrorMessage(cause, "The media file could not be deleted.") });
      return false;
    } finally {
      setDeletingLibraryAssetId(null);
    }
  }

  return (
    <div className="space-y-8 pb-10">
      <div className="stage-enter grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end"><div><p className="utility-label text-accent">Post Social / Composer</p><h1 className="mt-3 text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">Make something<br /><span className="scanline-accent">worth sharing.</span></h1><p className="mt-5 max-w-xl text-base leading-7 text-ink-muted">Add your content, choose where it goes, and publish when you are ready.</p><Link href="/app/library" className="mt-3 inline-flex text-sm font-semibold text-accent hover:text-accent-hover">Browse media library →</Link></div><div className="grooved-surface hidden max-w-sm rounded-lg border border-border bg-surface/90 px-5 py-4 text-sm leading-6 text-ink-muted lg:block"><strong className="block text-ink">{approvalCopy.title}</strong>{approvalCopy.body}</div></div>
      {message && <div role={message.kind === "error" ? "alert" : "status"} className={`grooved-surface rounded-xl border p-4 text-sm ${message.kind === "error" ? "border-error/25 bg-error-bg text-error" : "border-success/25 bg-success-bg text-success"}`}>{message.text}</div>}
      <div className="grooved-surface stage-enter-delayed rounded-xl border border-border bg-surface/95 p-5 shadow-hairline md:p-7"><Composer accounts={accounts} tiktokCreatorInfo={tiktokInfo} libraryAssets={(liveMedia ?? []).map((asset) => ({ id: asset._id, fileName: asset.fileName, mimeType: asset.mimeType, mediaType: asset.mediaType, sizeBytes: asset.sizeBytes, durationSeconds: asset.durationSeconds, url: asset.url }))} publishLabel={approvalCopy.button} onSaveDraft={state => save(state, false)} onSchedule={(state, at) => save(state, true, at)} onPublish={state => save(state, true)} busy={busy} uploadProgress={uploadProgress} onDeleteLibraryAsset={handleDeleteLibraryAsset} deletingLibraryAssetId={deletingLibraryAssetId} /></div>
    </div>
  );
}
