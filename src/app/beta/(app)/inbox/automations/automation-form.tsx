"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/beta/ui";
import { cn } from "@/lib/utils";
import { automationPosts, createAutomation, updateAutomation, type AutomationInput } from "./actions";
import { accountLabel } from "../account-label";
import type { AccountOption, AutomationRow } from "./types";

const field = "h-9 w-full rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px] text-ps-text placeholder:text-ps-subtle";
const MATCH_HELP: Record<AutomationInput["match_mode"], string> = {
  word: "The keyword as a whole word: GUIDE fires on “send the guide!”, not “guidebook”.",
  contains: "The keyword anywhere, even inside another word.",
  exact: "Only when the whole comment is the keyword.",
};
const splitWords = (text: string) => text.split(",").map((w) => w.trim()).filter(Boolean);

function Field(props: { label: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-ps-muted">
        {props.label} {props.optional && <span className="text-ps-subtle">(optional)</span>}
      </span>
      {props.children}
      {props.hint && <span className="text-xs text-ps-subtle">{props.hint}</span>}
    </label>
  );
}

// What the follower sees: the DM, its link buttons and the public reply under their comment.
function Preview(props: { keyword: string; dm: string; buttons: Array<{ label: string; url: string }>; reply: string; publicOnly: boolean }) {
  const sample = (text: string) => text.replace(/\{username\}/g, "@jay");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="m-0 mb-2 text-xs text-ps-subtle">Under your post</p>
        <div className="rounded-xl border border-ps-line bg-ps-ground p-3">
          <p className="m-0 text-[13px]"><span className="font-medium">jay</span> {props.keyword || "Your keyword"}</p>
          {props.reply && <p className="m-0 mt-2 border-l-2 border-ps-line pl-2.5 text-[13px] text-ps-muted"><span className="font-medium text-ps-text">You</span> {sample(props.reply)}</p>}
        </div>
      </div>
      {!props.publicOnly && <div>
        <p className="m-0 mb-2 text-xs text-ps-subtle">In their DMs</p>
        <div className="rounded-xl border border-ps-line bg-ps-ground p-3">
          <div className="max-w-[260px] rounded-2xl rounded-bl-md bg-ps-segment px-3 py-2 text-[13px] whitespace-pre-wrap">{sample(props.dm) || "Your message"}</div>
          {props.buttons.filter((b) => b.label).map((b, i) => (
            <div key={i} className="mt-1.5 max-w-[260px] rounded-xl border border-ps-line-strong px-3 py-2 text-center text-[13px] font-medium text-ps-plum">{b.label}</div>
          ))}
        </div>
      </div>}
    </div>
  );
}

export function AutomationForm(props: { workspaceId: string; accounts: AccountOption[]; automation?: AutomationRow; backHref: string }) {
  const router = useRouter();
  const a = props.automation;
  const [accountId, setAccountId] = useState(a?.connected_account_id ?? props.accounts[0]?.id ?? "");
  // Threads has no DMs: there the automation only replies publicly.
  const publicOnly = (a?.account?.platform ?? props.accounts.find((x) => x.id === accountId)?.platform) === "threads";
  const [name, setName] = useState(a?.name ?? "");
  const [postId, setPostId] = useState<string>(a?.platform_post_id ?? "");
  const [posts, setPosts] = useState<Array<{ platform_post_id: string; caption: string | null; published_at: string }>>([]);
  const [keywords, setKeywords] = useState((a?.keywords ?? []).join(", ").toUpperCase());
  const [matchMode, setMatchMode] = useState<AutomationInput["match_mode"]>(a?.match_mode ?? "word");
  const [exclude, setExclude] = useState((a?.exclude_keywords ?? []).join(", "));
  const [dm, setDm] = useState(a?.dm_message ?? "");
  const [buttons, setButtons] = useState<Array<{ label: string; url: string }>>(a?.dm_buttons.length ? a.dm_buttons : [{ label: "", url: "" }]);
  const [reply, setReply] = useState(a?.comment_reply ?? "");
  const [repeat, setRepeat] = useState<AutomationInput["repeat_mode"]>(a?.repeat_mode ?? "once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    void automationPosts(props.workspaceId, accountId).then((r) => live && r.ok && setPosts(r.data.posts));
    return () => {
      live = false;
    };
  }, [accountId, props.workspaceId]);

  const usedButtons = buttons.filter((b) => b.label.trim() || b.url.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input: AutomationInput = {
      name,
      platform_post_id: postId || null,
      keywords: splitWords(keywords),
      match_mode: matchMode,
      exclude_keywords: splitWords(exclude),
      dm_message: dm,
      dm_buttons: usedButtons,
      comment_reply: reply.trim() || null,
      repeat_mode: repeat,
      is_active: a?.is_active ?? true,
    };
    const result = a ? await updateAutomation(a.id, input) : await createAutomation(props.workspaceId, { ...input, account_id: accountId });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.push(props.backHref.replace("/automations", `/automations/${result.data.automation.id}`));
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="m-0 text-[13px] font-medium">Trigger</h2>
          <Field label="Name" hint="Only you see this.">
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Free guide" className={field} />
          </Field>
          {!a && (
            <Field label="Account">
              <select value={accountId} onChange={(e) => (setAccountId(e.target.value), setPostId(""))} className={field}>
                {props.accounts.map((acc) => <option key={acc.id} value={acc.id}>{accountLabel(acc)}</option>)}
              </select>
            </Field>
          )}
          <Field label="Post" hint="Posts published through Post Social. Every post includes ones you publish later.">
            <select value={postId} onChange={(e) => setPostId(e.target.value)} className={field}>
              <option value="">Every post</option>
              {postId && !posts.some((p) => p.platform_post_id === postId) && <option value={postId}>The current post</option>}
              {posts.map((p) => (
                <option key={p.platform_post_id} value={p.platform_post_id}>
                  {new Date(p.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {(p.caption ?? "No caption").slice(0, 60)}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Field label="Keywords" hint="Separate with commas. Leave empty to answer every comment.">
              <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="GUIDE, LINK" className={field} />
            </Field>
            <Field label="Match">
              <select value={matchMode} onChange={(e) => setMatchMode(e.target.value as AutomationInput["match_mode"])} className={field}>
                <option value="word">Whole word</option>
                <option value="contains">Anywhere</option>
                <option value="exact">Exact comment</option>
              </select>
            </Field>
          </div>
          <p className="-mt-2 m-0 text-xs text-ps-subtle">{MATCH_HELP[matchMode]}</p>
          <Field label="Ignore comments with" optional hint="Separate with commas.">
            <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="unsubscribe" className={field} />
          </Field>
        </Card>

        {!publicOnly && <Card className="flex flex-col gap-4 p-5">
          <h2 className="m-0 text-[13px] font-medium">The DM</h2>
          <Field label="Message" hint="{username} becomes their @handle (their name on Facebook). One DM per comment.">
            <textarea required maxLength={640} rows={4} value={dm} onChange={(e) => setDm(e.target.value)} placeholder="Hey {username}! Here's the free guide 👇" className={cn(field, "h-auto resize-y py-2")} />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ps-muted">Link buttons <span className="text-ps-subtle">(up to 3, clicks are counted)</span></span>
            {buttons.map((b, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
                <input maxLength={20} value={b.label} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Get the guide" aria-label={`Button ${i + 1} label`} className={field} />
                <input value={b.url} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://…" aria-label={`Button ${i + 1} link`} className={field} />
                <button type="button" onClick={() => setButtons(buttons.length > 1 ? buttons.filter((_, j) => j !== i) : [{ label: "", url: "" }])} className="h-9 rounded-lg px-2 text-xs text-ps-subtle hover:text-ps-text">Remove</button>
              </div>
            ))}
            {buttons.length < 3 && (
              <button type="button" onClick={() => setButtons([...buttons, { label: "", url: "" }])} className="self-start text-xs text-ps-plum hover:underline">Add a button</button>
            )}
          </div>
        </Card>}

        <Card className="flex flex-col gap-4 p-5">
          <h2 className="m-0 text-[13px] font-medium">{publicOnly ? "The reply" : "Also"}</h2>
          <Field label="Public reply to the comment" optional={!publicOnly} hint={publicOnly ? "Threads has no DMs, so the automation replies under their comment." : "Posted under their comment after the DM goes out."}>
            <input required={publicOnly} maxLength={300} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Sent you a DM 📩" className={field} />
          </Field>
          <Field label="If someone comments again">
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as AutomationInput["repeat_mode"])} className={field}>
              <option value="once">{publicOnly ? "Don't reply to them again" : "Don't DM them again"}</option>
              <option value="every_comment">{publicOnly ? "Reply every time" : "DM them every time"}</option>
            </select>
          </Field>
        </Card>

        {error && <p role="alert" className="m-0 text-xs text-ps-failed-text">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy || !name.trim() || !(publicOnly ? reply.trim() : dm.trim()) || !accountId} className="h-9 rounded-lg bg-ps-plum px-4 text-[13px] font-medium text-ps-ground hover:bg-ps-plum-hover disabled:opacity-60">
            {busy ? "Saving…" : a ? "Save changes" : "Turn on automation"}
          </button>
          <button type="button" onClick={() => router.push(props.backHref)} className="h-9 rounded-lg px-3 text-xs text-ps-subtle hover:text-ps-text">Cancel</button>
        </div>
      </div>
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card className="p-5">
          <h2 className="m-0 mb-4 text-[13px] font-medium">Preview</h2>
          <Preview keyword={splitWords(keywords)[0] ?? ""} dm={dm} buttons={usedButtons} reply={reply} publicOnly={publicOnly} />
        </Card>
      </aside>
    </form>
  );
}
