"use client";

import { useCallback, useState } from "react";
import { uploadParts, xhrPutPart, type PresignedPart } from "@/lib/media/part-upload";
import { callMedia } from "@/app/beta/(app)/media/actions";

export type UploadState = { key: string; name: string; progress: number; error?: string; mediaId?: string; status: "uploading" | "checking" | "ready" | "failed" };
export type ReadyMedia = { id: string; name: string; media_type: "image" | "video"; width: number | null; height: number | null; duration_seconds: number | null; status: string; failure_reason: string | null };

// Uploads files straight to storage in parts, then waits until Post Social has checked
// each one (size, length, shape). Shared by the composer and the media library.
export function useUpload(workspaceId: string, onReady?: (media: ReadyMedia) => void) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const update = (key: string, change: Partial<UploadState>) => setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...change } : u)));

  const upload = useCallback(
    async (file: File) => {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((all) => [...all, { key, name: file.name, progress: 0, status: "uploading" }]);
      const start = await callMedia<{ media_id: string; part_size: number; parts: PresignedPart[] }>({
        action: "create_upload",
        workspace_id: workspaceId,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (!start.ok) return update(key, { error: start.error, status: "failed" });
      try {
        const parts = await uploadParts({ file, partSize: start.data.part_size, parts: start.data.parts, putPart: xhrPutPart, onProgress: (progress) => update(key, { progress }) });
        const done = await callMedia<ReadyMedia>({ action: "complete_upload", media_id: start.data.media_id, parts });
        if (!done.ok) return update(key, { error: done.error, status: "failed" });
        update(key, { status: "checking", mediaId: start.data.media_id, progress: 1 });
        // Post Social checks the file in the background; wait for the verdict.
        for (let i = 0; i < 90; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const got = await callMedia<ReadyMedia>({ action: "get", media_id: start.data.media_id });
          if (!got.ok) continue;
          if (got.data.status === "ready") {
            update(key, { status: "ready" });
            onReady?.(got.data);
            setUploads((all) => all.filter((u) => u.key !== key));
            return;
          }
          if (got.data.status === "failed") return update(key, { status: "failed", error: got.data.failure_reason ?? "This file can't be used." });
        }
        update(key, { status: "failed", error: "Checking the file is taking too long. Find it in Media in a minute." });
      } catch {
        await callMedia({ action: "abort_upload", media_id: start.data.media_id });
        update(key, { status: "failed", error: "The upload was interrupted. Check your connection and try again." });
      }
    },
    [workspaceId, onReady],
  );

  const dismiss = (key: string) => setUploads((all) => all.filter((u) => u.key !== key));
  return { uploads, upload, dismiss };
}
