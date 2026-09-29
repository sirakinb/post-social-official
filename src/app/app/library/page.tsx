"use client";

import { ChangeEvent, useRef, useState } from "react";
import Image from "next/image";
import { useMutation, useQuery } from "convex/react";
import { FileVideo, ImageIcon, Plus, Trash2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { friendlyErrorMessage } from "@/lib/error-message";
import { mediaRemovalMessage } from "@/lib/media-removal-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function LibraryPage() {
  const workspace = useWorkspace();
  const assets = useQuery(api.media.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const saveUploaded = useMutation(api.media.saveUploaded);
  const deleteUnused = useMutation(api.media.deleteUnused);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!workspace.workspaceId || files.length === 0) return;
    setBusy("upload"); setMessage(null);
    try {
      for (const file of files) {
        const uploadUrl = await generateUploadUrl({ workspaceId: workspace.workspaceId });
        const response = await fetch(uploadUrl, { method: "POST", headers: { "content-type": file.type }, body: file });
        if (!response.ok) throw new Error(`${file.name} could not be uploaded.`);
        const { storageId } = await response.json() as { storageId: Id<"_storage"> };
        await saveUploaded({ workspaceId: workspace.workspaceId, storageId, fileName: file.name, mimeType: file.type, mediaType: file.type.startsWith("video/") ? "video" : "image", sizeBytes: file.size });
      }
      setMessage(`${files.length} media file${files.length === 1 ? "" : "s"} added to your library.`);
    } catch (cause) { setMessage(friendlyErrorMessage(cause, "The media could not be uploaded.")); }
    finally { setBusy(null); event.target.value = ""; }
  }

  async function remove(asset: { _id: string; fileName: string }) {
    if (!workspace.workspaceId || !window.confirm(`Remove "${asset.fileName}" from your library? Unused files will be permanently deleted. Existing posts will be preserved.`)) return;
    setBusy(asset._id); setMessage(null);
    try { const result = await deleteUnused({ workspaceId: workspace.workspaceId, mediaId: asset._id as Id<"mediaAssets"> }); setMessage(mediaRemovalMessage(result)); }
    catch (cause) { setMessage(friendlyErrorMessage(cause, "The media file could not be deleted.")); }
    finally { setBusy(null); }
  }

  return <div className="space-y-8 pb-10">
    <header className="stage-enter flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="utility-label text-accent">Post Social / Media</p><h1 className="mt-3 text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">Your media library<span className="scanline-accent">.</span></h1><p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted">Upload once, then reuse the same image or video in the composer or through the API.</p></div><div><input ref={inputRef} className="sr-only" type="file" accept="image/*,video/*" multiple onChange={upload} /><Button variant="primary" disabled={busy !== null} onClick={() => workspace.mode === "live" ? inputRef.current?.click() : setMessage("Sign in to upload media.")}><Plus className="h-4 w-4" />{busy === "upload" ? "Uploading…" : "Add media"}</Button></div></header>
    {message ? <div role="status" className="grooved-surface rounded-xl border border-accent/30 bg-accent-muted/40 p-4 text-sm text-ink">{message}</div> : null}
    {workspace.mode === "demo" ? <Card><CardContent className="p-10 text-center"><p className="font-semibold text-ink">Your reusable media will live here.</p><p className="mt-2 text-sm text-ink-muted">Sign in to upload an image or video and select it again from any new post.</p></CardContent></Card> : assets?.length ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{assets.map((asset) => <li key={asset._id} className="grooved-surface overflow-hidden rounded-xl border border-border bg-surface"><div className="relative aspect-video bg-canvas">{asset.url && asset.mediaType === "image" ? <Image unoptimized fill sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw" src={asset.url} alt={asset.fileName} className="object-cover" /> : <div className="flex h-full items-center justify-center text-accent">{asset.mediaType === "video" ? <FileVideo className="h-9 w-9" /> : <ImageIcon className="h-9 w-9" />}</div>}</div><div className="flex items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{asset.fileName}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-ink-subtle">{asset.mediaType} · {(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB</p></div><Button aria-label={`Delete ${asset.fileName}`} size="sm" variant="danger" disabled={busy !== null} onClick={() => remove(asset)}><Trash2 className="h-4 w-4" /></Button></div></li>)}</ul> : <Card><CardContent className="p-10 text-center"><p className="font-semibold text-ink">No reusable media yet.</p><p className="mt-2 text-sm text-ink-muted">Add your first image or video, or upload from the composer.</p></CardContent></Card>}
  </div>;
}
