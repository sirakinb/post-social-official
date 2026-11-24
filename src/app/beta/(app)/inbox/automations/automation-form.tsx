"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/beta/ui";
import { cn } from "@/lib/utils";
import { createAutomation, updateAutomation, type automationPosts, type AutomationInput } from "./actions";
import { PostPicker } from "./post-picker";
import { AutomationPreview } from "./preview";
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

// A numbered part of the form: what triggers it, what gets sent, what else happens.
function Section(props: { step: number; title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-baseline gap-3 border-b border-ps-fg/[0.06] px-5 py-3.5">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-ps-subtle">{String(props.step).padStart(2, "0")}</span>
        <h2 className="m-0 text-[13px] font-medium">{props.title}</h2>
        {props.note && <span className="ml-auto text-xs text-ps-subtle">{props.note}</span>}
      </div>
      <div className="flex flex-col gap-4 p-5">{props.children}</div>
    </Card>
  );
}

export function AutomationForm(props: { workspaceId: string; accounts: AccountOption[]; automation?: AutomationRow; backHref: string; loadPosts?: typeof automationPosts }) {
  const router = useRouter();
  const a = props.automation;
  const [accountId, setAccountId] = useState(a?.connected_account_id ?? props.accounts[0]?.id ?? "");
  const account = a?.account ?? props.accounts.find((x) => x.id === accountId);
  const platform = account?.platform ?? "instagram";
  // Threads has no DMs: there the automation only replies publicly.
  const publicOnly = platform === "threads";
  const [name, setName] = useState(a?.name ?? "");
  const [postId, setPostId] = useState<string>(a?.platform_post_id ?? "");
  const [onePost, setOnePost] = useState(Boolean(a?.platform_post_id));
  const [keywords, setKeywords] = useState((a?.keywords ?? []).join(", ").toUpperCase());
  const [matchMode, setMatchMode] = useState<AutomationInput["match_mode"]>(a?.match_mode ?? "word");
  const [exclude, setExclude] = useState((a?.exclude_keywords ?? []).join(", "));
  const [dm, setDm] = useState(a?.dm_message ?? "");
  const [buttons, setButtons] = useState<Array<{ label: string; url: string }>>(a?.dm_buttons.length ? a.dm_buttons : [{ label: "", url: "" }]);
  const [reply, setReply] = useState(a?.comment_reply ?? "");
  const [repeat, setRepeat] = useState<AutomationInput["repeat_mode"]>(a?.repeat_mode ?? "once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedButtons = buttons.filter((b) => b.label.trim() || b.url.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (onePost && !postId) return setError("Pick the post, or choose Every post.");
    setBusy(true);
    setError(null);
    const input: AutomationInput = {
      name,
      platform_post_id: onePost && postId ? postId : null,
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
    <form onSubmit={save} className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        <Section step={1} title="When someone comments">
          <div className={cn("grid gap-4", !a && "sm:grid-cols-2")}>
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
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-ps-muted">On</span>
            <PostPicker key={accountId} workspaceId={props.workspaceId} accountId={accountId} platform={platform} onePost={onePost} onOnePost={setOnePost} value={postId} onChange={(id) => (setPostId(id), setError(null))} loadPosts={props.loadPosts} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Field label="Keywords" hint="Separate with commas. Leave empty to answer every comment.">
              <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="GUIDE, LINK" className={cn(field, "font-mono uppercase placeholder:normal-case")} />
            </Field>
            <Field label="Match" hint={MATCH_HELP[matchMode]}>
              <select value={matchMode} onChange={(e) => setMatchMode(e.target.value as AutomationInput["match_mode"])} className={field}>
                <option value="word">Whole word</option>
                <option value="contains">Anywhere</option>
                <option value="exact">Exact comment</option>
              </select>
            </Field>
          </div>
          <Field label="Ignore comments with" optional hint="Separate with commas.">
            <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="unsubscribe" className={field} />
          </Field>
        </Section>

        {!publicOnly && (
          <Section step={2} title="Send them this DM" note="One DM per comment">
            <Field label="Message" hint={`{username} becomes ${platform === "facebook" ? "their name" : "their @handle"}.`}>
              <textarea required maxLength={640} rows={4} value={dm} onChange={(e) => setDm(e.target.value)} placeholder="Hey {username}! Here's the free guide." className={cn(field, "h-auto resize-y py-2")} />
              <span className="self-end font-mono text-[10.5px] text-ps-subtle">{dm.length} / 640</span>
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
          </Section>
        )}

        <Section step={publicOnly ? 2 : 3} title={publicOnly ? "Reply under their comment" : "And reply under their comment"} note={publicOnly ? undefined : "Optional"}>
          <Field label="Public reply" hint={publicOnly ? "Threads has no DMs, so the automation replies under their comment." : "Posted under their comment after the DM goes out."}>
            <input required={publicOnly} maxLength={300} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Sent you a DM." className={field} />
          </Field>
          <Field label="If someone comments again">
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as AutomationInput["repeat_mode"])} className={field}>
              <option value="once">{publicOnly ? "Don't reply to them again" : "Don't DM them again"}</option>
              <option value="every_comment">{publicOnly ? "Reply every time" : "DM them every time"}</option>
            </select>
          </Field>
        </Section>

        {error && <p role="alert" className="m-0 text-xs text-ps-failed-text">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy || !name.trim() || !(publicOnly ? reply.trim() : dm.trim()) || !accountId} className="h-9 rounded-lg bg-ps-plum px-4 text-[13px] font-medium text-ps-ground hover:bg-ps-plum-hover disabled:opacity-60">
            {busy ? "Saving…" : a ? "Save changes" : "Turn on automation"}
          </button>
          <button type="button" onClick={() => router.push(props.backHref)} className="h-9 rounded-lg px-3 text-xs text-ps-subtle hover:text-ps-text">Cancel</button>
        </div>
      </div>
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card>
          <div className="border-b border-ps-fg/[0.06] px-5 py-3.5">
            <h2 className="m-0 text-[13px] font-medium">What they see</h2>
          </div>
          <div className="p-5">
            <AutomationPreview platform={platform} account={account ? accountLabel(account) : "Your account"} keyword={splitWords(keywords)[0]?.toUpperCase() ?? ""} dm={dm} buttons={usedButtons} reply={reply} publicOnly={publicOnly} />
          </div>
        </Card>
      </aside>
    </form>
  );
}
