"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateContact } from "../actions";

const field = "h-9 w-full rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px] text-ps-text placeholder:text-ps-subtle";

// Edits one contact's email, tags and notes, in place.
export function ContactEditor(props: { id: string; email: string | null; tags: string[]; notes: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(props.email ?? "");
  const [tags, setTags] = useState(props.tags.join(", "));
  const [notes, setNotes] = useState(props.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-ps-plum hover:underline">Edit</button>;
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const result = await updateContact(props.id, { email: email.trim() || null, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), notes: notes.trim() || null });
        setBusy(false);
        if (!result.ok) return setError(result.error);
        setOpen(false);
        router.refresh();
      }}
    >
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" className={field} />
      <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" aria-label="Tags" className={field} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Notes" aria-label="Notes" className={`${field} h-auto resize-y py-2`} />
      {error && <p role="alert" className="m-0 text-xs text-ps-failed-text">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="h-8 rounded-lg bg-ps-plum px-3 text-xs font-medium text-ps-ground disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-lg px-2 text-xs text-ps-subtle hover:text-ps-text">Cancel</button>
      </div>
    </form>
  );
}
