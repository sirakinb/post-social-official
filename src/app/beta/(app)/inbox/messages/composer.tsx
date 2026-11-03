"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage, setConversationStatus } from "../actions";

// The reply box. Instagram allows replies only within 24 hours of the person's last message,
// so outside that window it explains instead of offering to send.
export function Composer(props: { conversationId: string; canReply: boolean; replyUntil: string | null; readOnly: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (props.readOnly) return <p className="m-0 border-t border-ps-line px-4 py-3 text-xs text-ps-subtle">Reviewers can read the inbox but not reply.</p>;
  if (!props.canReply) {
    return <p className="m-0 border-t border-ps-line px-4 py-3 text-xs text-ps-subtle">Instagram allows replies within 24 hours of their last message. You can reply once they message you again.</p>;
  }
  const until = props.replyUntil ? new Date(props.replyUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <form
      className="flex flex-col gap-2 border-t border-ps-line p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setError(null);
        const result = await sendMessage(props.conversationId, text);
        setBusy(false);
        if (!result.ok) return setError(result.error);
        setText("");
        router.refresh();
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        maxLength={1000}
        rows={2}
        placeholder="Write a reply…"
        className="w-full resize-none rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 py-2 text-[13px] text-ps-text placeholder:text-ps-subtle"
      />
      <div className="flex items-center gap-2">
        <span className="text-xs text-ps-subtle">{until ? `You can reply until ${until}` : null}</span>
        {error && <span role="alert" className="text-xs text-ps-failed-text">{error}</span>}
        <span className="flex-1" />
        <button type="submit" disabled={busy || !text.trim()} className="h-8 rounded-lg bg-ps-plum px-3.5 text-[13px] font-medium text-ps-ground hover:bg-ps-plum-hover disabled:opacity-60">
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

export function DoneButton(props: { conversationId: string; status: "open" | "done" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await setConversationStatus(props.conversationId, props.status === "open" ? "done" : "open");
        setBusy(false);
        router.refresh();
      }}
      className="h-8 rounded-lg border border-ps-line-strong px-3 text-xs hover:border-ps-fg/30 disabled:opacity-60"
    >
      {props.status === "open" ? "Mark done" : "Reopen"}
    </button>
  );
}
