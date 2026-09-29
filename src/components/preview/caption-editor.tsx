"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopyCaptionButton } from "@/components/copy-caption-button";
import { friendlyErrorMessage } from "@/lib/error-message";

export type CaptionSaveResult = { changed: boolean; needsReapproval: boolean };

type Props = {
  caption: string;
  /** False for published/sending posts and demo data: the caption is shown but cannot change. */
  editable: boolean;
  /** True when saving will send an approved post back for approval. */
  willNeedReapproval: boolean;
  limit: number;
  onSave: (caption: string) => Promise<CaptionSaveResult>;
  /** Called while typing so a mockup can show the unsaved wording; null when editing ends. */
  onDraftChange?: (draft: string | null) => void;
};

export function CaptionEditor({ caption, editable, willNeedReapproval, limit, onSave, onDraftChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(caption);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function begin() {
    setDraft(caption);
    setError(null);
    setNotice(null);
    setEditing(true);
    onDraftChange?.(caption);
  }
  function stop() {
    setEditing(false);
    onDraftChange?.(null);
  }
  function change(value: string) {
    setDraft(value);
    onDraftChange?.(value);
  }
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(draft);
      setNotice(!result.changed ? "No changes to save." : result.needsReapproval ? "Saved. This post needs approval again before it will publish." : "Saved.");
      stop();
    } catch (cause) {
      setError(friendlyErrorMessage(cause, "The caption could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  const over = draft.length > limit;

  return (
    <section className="grooved-surface space-y-3 rounded-xl border border-border bg-surface/95 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[.18em] text-ink-subtle">Caption</h2>
        {!editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <CopyCaptionButton text={caption} />
            {editable ? <Button type="button" size="sm" variant="secondary" onClick={begin} data-testid="edit-caption"><Pencil className="h-4 w-4" />Edit caption</Button> : null}
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-3">
          <Textarea value={draft} onChange={(event) => change(event.target.value)} rows={6} aria-label="Caption" data-testid="caption-input" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`text-xs ${over ? "text-error" : "text-ink-subtle"}`} data-testid="caption-count">{draft.length.toLocaleString()} / {limit.toLocaleString()} characters</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={stop} disabled={saving}>Cancel</Button>
              <Button type="button" size="sm" variant="primary" onClick={save} disabled={saving || over || draft.trim().length === 0} data-testid="save-caption">{saving ? "Saving…" : "Save caption"}</Button>
            </div>
          </div>
          {willNeedReapproval ? <p className="rounded-lg border border-warning/25 bg-warning-bg p-3 text-xs leading-5 text-warning" data-testid="reapproval-warning">This post was already approved. Changing the caption cancels its scheduled send and asks for approval again.</p> : null}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-base leading-7 text-ink" data-testid="preview-caption">{caption || "No caption."}</p>
      )}

      {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
    </section>
  );
}
