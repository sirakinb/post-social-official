"use client";

import { Upload, FileVideo, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";
import { SelectedMedia } from "@/lib/types";

interface MediaDropZoneProps {
  files: SelectedMedia[];
  onFilesChange: (files: SelectedMedia[]) => void;
  className?: string;
}

export function MediaDropZone({
  files,
  onFilesChange,
  className,
}: MediaDropZoneProps) {
  const [dragActive, setDragActive] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function inspectFiles(files: File[]) {
    const inspected = await Promise.all(
      files.map(async (file): Promise<SelectedMedia> => {
        if (!file.type.startsWith("video/")) return { file };
        const durationSeconds = await new Promise<number | undefined>((resolve) => {
          const video = document.createElement("video");
          const url = URL.createObjectURL(file);
          const finish = (duration?: number) => {
            URL.revokeObjectURL(url);
            resolve(duration);
          };
          video.preload = "metadata";
          video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : undefined);
          video.onerror = () => finish();
          video.src = url;
        });
        return { file, durationSeconds };
      })
    );
    onFilesChange(inspected);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length) {
      void inspectFiles(Array.from(e.dataTransfer.files));
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      void inspectFiles(Array.from(e.target.files));
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed bg-surface p-6 transition-colors",
        dragActive
          ? "border-accent bg-accent-muted"
          : "border-border hover:border-border-strong",
        className
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Upload media"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/*,image/*"
        multiple
        className="sr-only"
        onChange={handleChange}
        data-testid="media-input"
      />
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas-ivory">
          <Upload className="h-5 w-5 text-ink-muted" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">
            Drop media here, or click to browse
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            MP4, MOV, JPG, PNG — up to 500 MB per file
          </p>
        </div>
      </div>
      {files.length > 0 && (
        <ul className="mt-5 space-y-2 border-t border-border pt-4">
          {files.map((media, idx) => (
            <li
              key={`${media.file.name}-${idx}`}
              className="flex items-center gap-2 text-sm text-ink-muted"
            >
              {media.file.type.startsWith("video/") ? (
                <FileVideo className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ImageIcon className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="truncate">{media.file.name}</span>
              {media.durationSeconds !== undefined && (
                <span className="ml-auto shrink-0 text-xs text-ink-subtle">
                  {Math.round(media.durationSeconds)} sec
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
