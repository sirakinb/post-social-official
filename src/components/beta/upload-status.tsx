"use client";

import type { UploadState } from "./use-upload";

// One file on its way up: progress, "checking", a paused upload's Resume, or what went wrong.
export function UploadCard({ upload: u, onDismiss, onResume, className }: { upload: UploadState; onDismiss: () => void; onResume: () => void; className?: string }) {
  return (
    <div className={className}>
      <span className="truncate text-xs">{u.name}</span>
      {u.status === "paused" ? (
        <>
          <span className="h-[3px] rounded bg-ps-fg/[0.06]"><span className="block h-full rounded bg-ps-fg/30" style={{ width: `${Math.round(u.progress * 100)}%` }} /></span>
          <span className="text-[11px] text-ps-subtle">
            {u.error} <button type="button" onClick={onResume} className="underline">Resume</button> · <button type="button" onClick={onDismiss} className="underline">Cancel</button>
          </span>
        </>
      ) : u.error ? (
        <span className="text-xs text-ps-failed-text">{u.error} <button type="button" onClick={onDismiss} className="underline">Dismiss</button></span>
      ) : (
        <>
          <span className="h-[3px] rounded bg-ps-fg/[0.06]"><span className="block h-full rounded bg-ps-plum" style={{ width: `${Math.round(u.progress * 100)}%` }} /></span>
          <span className="text-[11px] text-ps-subtle">{u.status === "checking" ? "Checking the file…" : `Uploading ${Math.round(u.progress * 100)}%`}</span>
        </>
      )}
    </div>
  );
}

// Phones stop a page that is hidden or locked, which stops its uploads.
export function KeepOpenNote() {
  return <p className="m-0 w-full text-[11px] text-ps-subtle">Keep this page open until your files finish uploading. If your phone locks or you switch apps, the upload pauses and carries on when you come back.</p>;
}
