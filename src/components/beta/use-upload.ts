"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadParts, xhrPutPart, type PresignedPart, type UploadedPart } from "@/lib/media/part-upload";
import { callMedia } from "@/app/beta/(app)/media/actions";

// paused: the connection dropped or the phone put the page to sleep. The parts already sent
// are kept; it carries on by itself when the page is back and online, or with resume().
export type UploadState = { key: string; name: string; progress: number; error?: string; mediaId?: string; status: "uploading" | "paused" | "checking" | "ready" | "failed" };
export type ReadyMedia = { id: string; name: string; media_type: "image" | "video"; width: number | null; height: number | null; duration_seconds: number | null; status: string; failure_reason: string | null };

type Started = { media_id: string; part_size: number; parts: PresignedPart[]; expires_in_seconds?: number };
// What an unfinished upload needs to carry on: the file, its upload links and the parts sent.
type Pending = { file: File; started: Started; startedAt: number; done: UploadedPart[]; running: boolean };

// Upload links last an hour; past this, start the file again instead of resuming.
const LINKS_GOOD_FOR_MS = 50 * 60_000;
export const PAUSED_MESSAGE = "Paused. It carries on when you're back online with this page open.";

// Holds the screen awake while uploads run: a phone that locks mid-upload stops it.
type Lock = { release: () => Promise<void> };
async function requestWakeLock(): Promise<Lock | null> {
  try {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Lock> } }).wakeLock;
    return wakeLock ? await wakeLock.request("screen") : null;
  } catch {
    return null; // not allowed (battery saver, page hidden): uploads still run
  }
}

// Uploads files straight to storage in parts, then waits until Post Social has checked
// each one (size, length, shape). Shared by the composer and the media library.
export function useUpload(workspaceId: string, onReady?: (media: ReadyMedia) => void) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const pending = useRef(new Map<string, Pending>());
  // start() and send() call each other; through a ref so neither holds a stale copy.
  const sendRef = useRef<(key: string) => Promise<void>>(async () => undefined);
  const update = (key: string, change: Partial<UploadState>) => setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...change } : u)));

  const check = useCallback(
    async (key: string, mediaId: string) => {
      update(key, { status: "checking", mediaId, progress: 1, error: undefined });
      // Post Social checks the file in the background (and turns iPhone MOV into MP4); wait.
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const got = await callMedia<ReadyMedia>({ action: "get", media_id: mediaId });
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
    },
    [onReady],
  );

  const start = useCallback(
    async (key: string, file: File) => {
      const begun = await callMedia<Started>({ action: "create_upload", workspace_id: workspaceId, file_name: file.name, mime_type: file.type, size_bytes: file.size });
      if (!begun.ok) {
        pending.current.delete(key);
        return update(key, { error: begun.error, status: "failed" });
      }
      pending.current.set(key, { file, started: begun.data, startedAt: Date.now(), done: [], running: false });
      return sendRef.current(key);
    },
    [workspaceId],
  );

  // Sends the parts not yet stored; on a dropped connection, pauses instead of failing.
  const send = useCallback(
    async (key: string): Promise<void> => {
      const job = pending.current.get(key);
      if (!job || job.running) return;
      if (Date.now() - job.startedAt > LINKS_GOOD_FOR_MS) {
        // Too old to resume: cancel and start the file over.
        pending.current.delete(key);
        void callMedia({ action: "abort_upload", media_id: job.started.media_id });
        update(key, { status: "uploading", progress: 0, error: undefined });
        return start(key, job.file);
      }
      job.running = true;
      update(key, { status: "uploading", error: undefined, mediaId: job.started.media_id });
      try {
        const parts = await uploadParts({
          file: job.file,
          partSize: job.started.part_size,
          parts: job.started.parts,
          putPart: xhrPutPart,
          completed: job.done,
          onPartDone: (part) => job.done.push(part),
          onProgress: (progress) => update(key, { progress }),
        });
        const done = await callMedia<ReadyMedia>({ action: "complete_upload", media_id: job.started.media_id, parts });
        pending.current.delete(key);
        if (!done.ok) return update(key, { error: done.error, status: "failed" });
        await check(key, job.started.media_id);
      } catch {
        update(key, { status: "paused", error: PAUSED_MESSAGE });
      } finally {
        job.running = false;
      }
    },
    [check, start],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const upload = useCallback(
    async (file: File) => {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((all) => [...all, { key, name: file.name, progress: 0, status: "uploading" }]);
      await start(key, file);
    },
    [start],
  );

  const resume = useCallback((key: string) => void send(key), [send]);

  // Waits for a file that was uploaded elsewhere (the iPhone Shortcut) and is still being
  // checked, then hands it over like an upload from this page.
  const watch = useCallback(
    (mediaId: string, name: string) => {
      const key = `watch-${mediaId}`;
      setUploads((all) => (all.some((u) => u.key === key) ? all : [...all, { key, name, progress: 1, status: "checking", mediaId }]));
      void check(key, mediaId);
    },
    [check],
  );

  // Carry on by itself when the page comes back (phone unlocked, app switched back) or the
  // connection returns.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      for (const key of pending.current.keys()) void send(key);
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [send]);

  // Keep the screen awake while anything is sending. Phones drop the lock when the page is
  // hidden, so it is asked for again when the page is back.
  const sending = uploads.some((u) => u.status === "uploading");
  useEffect(() => {
    if (!sending) return;
    let lock: Lock | null = null;
    let stopped = false;
    const take = async () => {
      if (document.visibilityState !== "visible") return;
      const got = await requestWakeLock();
      if (stopped) void got?.release().catch(() => undefined);
      else lock = got;
    };
    void take();
    document.addEventListener("visibilitychange", take);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => undefined);
    };
  }, [sending]);

  const dismiss = (key: string) => {
    const job = pending.current.get(key);
    if (job) {
      pending.current.delete(key);
      void callMedia({ action: "abort_upload", media_id: job.started.media_id });
    }
    setUploads((all) => all.filter((u) => u.key !== key));
  };
  // Shown while any file is still being sent from this device.
  const keepOpen = uploads.some((u) => u.status === "uploading" || u.status === "paused");
  return { uploads, upload, dismiss, resume, watch, keepOpen };
}
