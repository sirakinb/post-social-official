"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes, formatDuration, uploadParts, xhrPutPart, type PresignedPart } from "@/lib/media/part-upload";
import { callMedia } from "./actions";

export type MediaItem = {
  id: string;
  status: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  failureReason: string | null;
  hidden: boolean;
  createdAt: string;
};

type Upload = { key: string; name: string; progress: number; error?: string; cancel: () => void };

const STATUS: Record<string, { label: string; variant: "default" | "accent" | "success" | "warning" | "error" | "info" }> = {
  processing: { label: "Checking", variant: "info" },
  ready: { label: "Ready", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  expired: { label: "Expired", variant: "warning" },
};

export function MediaLibrary(props: {
  workspaceId: string;
  workspaceName: string;
  canEdit: boolean;
  showHidden: boolean;
  items: MediaItem[];
  loadError: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [message, setMessage] = useState<{ kind: "error" | "notice"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // Refresh while anything is still being checked by the worker.
  const processing = props.items.some((item) => item.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [processing, router]);

  const updateUpload = (key: string, change: Partial<Upload>) =>
    setUploads((current) => current.map((u) => (u.key === key ? { ...u, ...change } : u)));

  async function uploadFile(file: File) {
    const key = `${file.name}-${Date.now()}-${Math.random()}`;
    const controller = new AbortController();
    setUploads((current) => [...current, { key, name: file.name, progress: 0, cancel: () => controller.abort() }]);

    const start = await callMedia<{ media_id: string; part_size: number; parts: PresignedPart[] }>({
      action: "create_upload",
      workspace_id: props.workspaceId,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    });
    if (!start.ok) return updateUpload(key, { error: start.error });

    try {
      const parts = await uploadParts({
        file,
        partSize: start.data.part_size,
        parts: start.data.parts,
        putPart: xhrPutPart,
        signal: controller.signal,
        onProgress: (progress) => updateUpload(key, { progress }),
      });
      const done = await callMedia({ action: "complete_upload", media_id: start.data.media_id, parts });
      if (!done.ok) return updateUpload(key, { error: done.error });
      setUploads((current) => current.filter((u) => u.key !== key));
      router.refresh();
    } catch (error) {
      await callMedia({ action: "abort_upload", media_id: start.data.media_id });
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      if (cancelled) setUploads((current) => current.filter((u) => u.key !== key));
      else updateUpload(key, { error: "The upload was interrupted. Check your connection and try again." });
    }
  }

  function onFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) void uploadFile(file);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const url = String(new FormData(form).get("url") ?? "");
    setImporting(true);
    setMessage(null);
    const result = await callMedia({ action: "import", workspace_id: props.workspaceId, url });
    setImporting(false);
    if (!result.ok) return setMessage({ kind: "error", text: result.error });
    form.reset();
    setMessage({ kind: "notice", text: "Importing. The file appears below and is checked automatically." });
    router.refresh();
  }

  async function act(payload: { action: string } & Record<string, unknown>) {
    setMessage(null);
    const result = await callMedia(payload);
    if (!result.ok) setMessage({ kind: "error", text: result.error });
    router.refresh();
    return result.ok;
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="utility-label text-accent">{props.workspaceName} / Media</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-ink">Media library</h1>
          <p className="mt-1 text-sm text-ink-muted">Videos and images ready to post. Files unused for 30 days are removed to save storage.</p>
        </div>
        <Link href={props.showHidden ? "/beta/media" : "/beta/media?hidden=1"} className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          {props.showHidden ? "Back to library" : "Show hidden media"}
        </Link>
      </div>

      {props.canEdit && !props.showHidden && (
        <section className="mt-8 grid gap-4 md:grid-cols-2">
          <div
            className="grooved-surface flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-6 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onFiles(event.dataTransfer.files);
            }}
          >
            <p className="text-sm font-medium text-ink">Upload videos or images</p>
            <p className="mt-1 text-xs text-ink-subtle">MP4, MOV, WebM, JPEG, PNG or WebP, up to 1 GB each. Drop files here or choose them.</p>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
              className="sr-only"
              id="media-file"
              onChange={(event) => onFiles(event.target.files)}
            />
            <Button asChild variant="primary" className="mt-4"><label htmlFor="media-file" className="cursor-pointer">Choose files</label></Button>
          </div>
          <form onSubmit={onImport} className="grooved-surface rounded-xl border border-border bg-surface p-6">
            <label htmlFor="import-url" className="text-sm font-medium text-ink">Import from a link</label>
            <p className="mt-1 text-xs text-ink-subtle">Paste an https link to a video or image file.</p>
            <Input id="import-url" name="url" type="url" required placeholder="https://example.com/clip.mp4" className="mt-3" />
            <Button type="submit" className="mt-3" disabled={importing}>{importing ? "Starting…" : "Import"}</Button>
          </form>
        </section>
      )}

      {uploads.length > 0 && (
        <ul className="mt-6 space-y-2" aria-label="Uploads in progress">
          {uploads.map((upload) => (
            <li key={upload.key} className="rounded-lg border border-border bg-surface p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-ink">{upload.name}</span>
                {upload.error ? (
                  <Button size="sm" variant="ghost" onClick={() => setUploads((c) => c.filter((u) => u.key !== upload.key))}>Dismiss</Button>
                ) : (
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-xs text-ink-muted">{Math.round(upload.progress * 100)}%</span>
                    <Button size="sm" variant="ghost" onClick={upload.cancel}>Cancel</Button>
                  </span>
                )}
              </div>
              {upload.error ? (
                <p role="alert" className="mt-2 text-error">{upload.error}</p>
              ) : (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas-ivory" role="progressbar" aria-label={`Uploading ${upload.name}`} aria-valuenow={Math.round(upload.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${upload.progress * 100}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`mt-6 rounded-lg border p-3 text-sm ${message.kind === "error" ? "border-error/20 bg-error-bg text-error" : "border-border bg-canvas-ivory text-ink"}`}>
          {message.text}
        </p>
      )}

      <section className="mt-8">
        {props.loadError ? (
          <p role="alert" className="text-sm text-error">Your media could not be loaded. Refresh the page to try again.</p>
        ) : props.items.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-ink-muted">
            {props.showHidden ? "No hidden media." : "No media yet. Upload a file or import one from a link."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {props.items.map((item) => {
              const status = STATUS[item.status] ?? { label: item.status, variant: "default" as const };
              const details = [
                item.mediaType === "video" ? "Video" : "Image",
                item.sizeBytes ? formatBytes(item.sizeBytes) : null,
                item.width && item.height ? `${item.width}×${item.height}` : null,
                formatDuration(item.durationSeconds),
              ].filter(Boolean);
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    {editing === item.id ? (
                      <form
                        className="flex gap-2"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const name = String(new FormData(event.currentTarget).get("name") ?? "");
                          if (await act({ action: "rename", media_id: item.id, name })) setEditing(null);
                        }}
                      >
                        <Input name="name" defaultValue={item.name} aria-label="Media name" maxLength={200} autoFocus />
                        <Button type="submit" size="sm" variant="primary">Save</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </form>
                    ) : (
                      <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                    )}
                    <p className="mt-0.5 text-xs text-ink-subtle">{details.join(" · ")}</p>
                    {item.status === "failed" && item.failureReason && <p className="mt-1 text-xs text-error">{item.failureReason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    {props.canEdit && editing !== item.id && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(item.id)}>Rename</Button>
                        <Button size="sm" variant="ghost" onClick={() => act({ action: "set_hidden", media_id: item.id, hidden: !item.hidden })}>
                          {item.hidden ? "Restore" : "Hide"}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
