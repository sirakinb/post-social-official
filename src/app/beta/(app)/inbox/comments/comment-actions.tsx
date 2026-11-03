"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteComment, dmCommenter, hideComment, replyToComment } from "../actions";

// Delete, asking once first: it can't be undone (Instagram and Facebook only).
export function DeleteButton(props: { commentId: string; label?: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirm) return <button type="button" onClick={() => setConfirm(true)} className="text-ps-failed-text hover:underline">{props.label ?? "Delete"}</button>;
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await deleteComment(props.commentId);
          setBusy(false);
          if (!result.ok) return setError(result.error ?? "Something went wrong.");
          setConfirm(false);
          router.refresh();
        }}
        className="text-ps-failed-text underline disabled:opacity-60"
      >
        {busy ? "Deleting…" : "Delete for good"}
      </button>
      <button type="button" onClick={() => setConfirm(false)} className="text-ps-muted hover:text-ps-text">Keep</button>
      {error && <span role="alert" className="text-ps-failed-text">{error}</span>}
    </span>
  );
}

// Reply publicly, DM the commenter (one per comment, within 7 days), hide or delete, for one comment.
export function CommentActions(props: { commentId: string; canDm: boolean; canDelete: boolean; hidden: boolean; replied: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"reply" | "dm" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "Something went wrong.");
    setMode(null);
    setText("");
    router.refresh();
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => setMode(mode === "reply" ? null : "reply")} className="text-ps-plum hover:underline">{props.replied ? "Reply again" : "Reply"}</button>
        {props.canDm ? (
          <button type="button" onClick={() => setMode(mode === "dm" ? null : "dm")} className="text-ps-plum hover:underline">Send a DM</button>
        ) : (
          <span className="text-ps-subtle">DM not available</span>
        )}
        <button type="button" disabled={busy} onClick={() => run(() => hideComment(props.commentId, !props.hidden))} className="text-ps-muted hover:text-ps-text">{props.hidden ? "Unhide" : "Hide"}</button>
        {props.canDelete && <DeleteButton commentId={props.commentId} />}
        {error && <span role="alert" className="text-ps-failed-text">{error}</span>}
      </div>
      {mode && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => (mode === "reply" ? replyToComment(props.commentId, text) : dmCommenter(props.commentId, text)));
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={mode === "reply" ? "Public reply…" : "Private DM (one per comment)…"}
            className="h-9 flex-1 rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px] text-ps-text placeholder:text-ps-subtle"
          />
          <button type="submit" disabled={busy || !text.trim()} className="h-9 rounded-lg bg-ps-plum px-3.5 text-[13px] font-medium text-ps-ground hover:bg-ps-plum-hover disabled:opacity-60">
            {busy ? "Sending…" : mode === "reply" ? "Reply" : "Send DM"}
          </button>
        </form>
      )}
    </div>
  );
}
