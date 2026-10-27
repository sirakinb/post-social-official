"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountMark } from "@/components/beta/avatar-img";
import { Label, PlatformMark, Thumb } from "@/components/beta/ui";
import { useUpload, type ReadyMedia } from "@/components/beta/use-upload";
import { KeepOpenNote, UploadCard } from "@/components/beta/upload-status";
import { takeShared } from "@/lib/share-inbox";
import {
  captionLimits,
  defaultMediaType,
  defaultTitle,
  destinationOptions,
  effectiveCaption,
  MEDIA_TYPES,
  NAMES,
  NEW_TIKTOK,
  isTikTokPhotoPost,
  coverNotes,
  DEFAULT_COVER,
  type Cover,
  tiktokProblems,
  type ComposerAccount,
  type ComposerProfile,
  type ComposerMedia,
  type PlatformChoice,
} from "@/lib/beta/composer-model";
import { cn } from "@/lib/utils";
import type { CreatorInfo } from "../../../../../backend/lib/connections/tiktok-creator";
import { callPosts, getCreatorInfo, getMediaLinks } from "./actions";
import { Preview } from "./preview";
import { TikTokConsent, TikTokOptions } from "./tiktok-options";
import { CoverPicker } from "./cover-picker";

export type EditingPost = { id: string; status: string; caption: string; scheduledAt: string | null; mediaIds: string[]; accounts: Array<{ accountId: string; choice: PlatformChoice }>; cover?: Cover };
type Check = { ok: boolean; problems: string[] };
type Done = { status: string; scheduledAt: string | null; tiktokDirect: boolean };

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// waitFor: a file sent from the iPhone Shortcut that Post Social is still checking; it joins
// the post when ready.
export function Composer({ workspaceId, accounts, profiles = [], library: initialLibrary, editing, initialMedia = [], waitFor = null }: { workspaceId: string; accounts: ComposerAccount[]; profiles?: ComposerProfile[]; library: ComposerMedia[]; editing: EditingPost | null; initialMedia?: string[]; waitFor?: { id: string; name: string } | null }) {
  const [library, setLibrary] = useState(initialLibrary);
  const [selected, setSelected] = useState<string[]>(editing?.accounts.map((a) => a.accountId) ?? []);
  const [choices, setChoices] = useState<Record<string, PlatformChoice>>(() => Object.fromEntries((editing?.accounts ?? []).map((a) => [a.accountId, a.choice])));
  const [caption, setCaption] = useState(editing?.caption ?? "");
  const [mediaIds, setMediaIds] = useState<string[]>(editing?.mediaIds ?? initialMedia);
  const [cover, setCover] = useState<Cover>(editing?.cover ?? DEFAULT_COVER);
  const [tab, setTab] = useState<string>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [when, setWhen] = useState<"now" | "later">(editing?.scheduledAt ? "later" : "now");
  const [at, setAt] = useState(editing?.scheduledAt ? toLocalInput(editing.scheduledAt) : "");
  const [picker, setPicker] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  // Problems stay quiet until the person tries to post, so a new post doesn't open with errors.
  const [tried, setTried] = useState(false);
  const [creator, setCreator] = useState<Record<string, CreatorInfo | null>>({});
  const [creatorError, setCreatorError] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const chosen = accounts.filter((a) => selected.includes(a.id));
  // Show one profile's accounts; accounts already picked stay picked.
  const [profileFilter, setProfileFilter] = useState<string>("all");
  const visible = profileFilter === "all" ? accounts : accounts.filter((a) => (a.profileId ?? "none") === profileFilter || selected.includes(a.id));
  const media = mediaIds.map((id) => library.find((m) => m.id === id)).filter((m): m is ComposerMedia => Boolean(m));
  const choiceFor = (id: string) => choices[id] ?? {};
  const setChoice = (id: string, change: Partial<PlatformChoice>) => setChoices((all) => ({ ...all, [id]: { ...all[id], ...change } }));

  const [notice, setNotice] = useState<string | null>(null);
  const { uploads, upload, dismiss, resume, watch, keepOpen } = useUpload(workspaceId, async (m: ReadyMedia) => {
    const { links, posters } = await getMediaLinks(workspaceId, [m.id]);
    setLibrary((all) => [{ id: m.id, name: m.name ?? "Upload", type: m.media_type, width: m.width, height: m.height, duration: m.duration_seconds === null ? null : Number(m.duration_seconds), url: links[m.id] ?? null, poster: posters[m.id] ?? null }, ...all]);
    setMediaIds((ids) => [...ids, m.id]);
  });

  // Cover images are uploaded to the library but not added to the post.
  const coverUpload = useUpload(workspaceId, async (m: ReadyMedia) => {
    const { links } = await getMediaLinks(workspaceId, [m.id]);
    setLibrary((all) => [{ id: m.id, name: m.name ?? "Upload", type: m.media_type, width: m.width, height: m.height, duration: null, url: links[m.id] ?? null, poster: null }, ...all]);
    if (m.media_type === "image") setCover({ kind: "image", mediaId: m.id });
  });

  // Arriving from the phone's share sheet (Android) or the iPhone Shortcut: pick up the
  // shared files once, then tidy the address so a reload doesn't repeat it.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if (waitFor) watch(waitFor.id, waitFor.name);
    const shared = new URLSearchParams(window.location.search).get("shared");
    if (!shared) return;
    window.history.replaceState(null, "", "/beta/create");
    void (shared === "failed" ? Promise.resolve(null) : takeShared()).then((got) => {
      if (shared === "failed") return setNotice("The shared file didn't come through. Open Post Social once, then share again, or use Add media.");
      if (!got || got.files.length === 0) return setNotice("Nothing was shared. Use Add media to pick a photo or video.");
      for (const file of got.files) void upload(file);
      // Shared words become the caption, unless they're only a link (Instagram shares a link).
      if (got.text && !/^\s*https?:\/\/\S+\s*$/.test(got.text)) setCaption((c) => c || got.text);
    });
  }, [waitFor, watch, upload]);

  // TikTok's guidelines: read the creator's latest settings when the post page opens.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const a of chosen.filter((x) => x.platform === "tiktok")) {
      if (requested.current.has(a.id)) continue;
      requested.current.add(a.id);
      void getCreatorInfo(a.id).then((r) => {
        if (r.ok) setCreator((all) => ({ ...all, [a.id]: r.data }));
        else setCreatorError((all) => ({ ...all, [a.id]: r.error }));
      });
    }
  }, [chosen]);

  // The clock, for checking a scheduled time is still in the future.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const destinations = useMemo(
    () => chosen.map((a) => ({ account_id: a.id, options: destinationOptions(a, a.platform === "tiktok" ? { ...choiceFor(a.id), tiktok: choiceFor(a.id).tiktok ?? NEW_TIKTOK } : choiceFor(a.id), caption, media, cover) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen, choices, caption, media, cover],
  );

  // Checks against every platform's rules as the post changes (same check as AIs get).
  const seq = useRef(0);
  useEffect(() => {
    if (!destinations.length) return;
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      const r = await callPosts<Check>("validate", { workspace_id: workspaceId, caption, media_ids: mediaIds, destinations });
      if (n === seq.current) setCheck(r.ok ? r.data : { ok: false, problems: [r.error] });
    }, 500);
    return () => clearTimeout(timer);
  }, [destinations, caption, mediaIds, workspaceId]);

  const tiktokIssues = chosen.filter((a) => a.platform === "tiktok").flatMap((a) => tiktokProblems(choiceFor(a.id).tiktok ?? NEW_TIKTOK, creator[a.id] ?? null, media));
  const scheduleIssue = when === "later" && (!at || new Date(at).getTime() < now + 60_000) ? "Pick a time at least a minute from now." : null;
  const shownCheck = destinations.length ? check : null;
  const problems = [...(chosen.length ? [] : ["Choose at least one account."]), ...(shownCheck?.problems ?? []), ...tiktokIssues, ...(scheduleIssue ? [scheduleIssue] : [])];
  const limits = captionLimits(chosen, choices, caption);
  const directTikTok = chosen.find((a) => a.platform === "tiktok" && (choiceFor(a.id).tiktok ?? NEW_TIKTOK).mode === "direct");
  const brandedTikTok = Boolean(directTikTok && choiceFor(directTikTok.id).tiktok?.disclose && choiceFor(directTikTok.id).tiktok?.brandedContent);

  const previewAccount = chosen.find((a) => a.id === previewId) ?? chosen[0] ?? null;
  const tabAccount = chosen.find((a) => a.id === tab) ?? null;

  async function save(send: boolean) {
    setBusy(send ? "send" : "draft");
    setError(null);
    const scheduled_at = when === "later" && at ? new Date(at).toISOString() : null;
    const body = { caption, media_ids: mediaIds, destinations, scheduled_at };
    let postId = editing?.id ?? null;
    let status = editing?.status ?? "draft";
    if (postId) {
      const r = await callPosts<{ id: string; status: string }>("update", { post_id: postId, ...body });
      if (!r.ok) return fail(r.error);
      status = r.data.status;
    } else {
      const r = await callPosts<{ id: string; status: string }>("create", { workspace_id: workspaceId, ...body });
      if (!r.ok) return fail(r.error);
      postId = r.data.id;
      status = r.data.status;
    }
    if (send && status === "draft") {
      const r = await callPosts<{ status: string }>("submit", { post_id: postId });
      if (!r.ok) return fail(r.error);
      status = r.data.status;
    }
    setBusy(null);
    setDone({ status, scheduledAt: scheduled_at, tiktokDirect: Boolean(directTikTok) && send });
  }
  const fail = (message: string) => {
    setBusy(null);
    setError(message);
  };

  if (done) return <Finished done={done} />;

  const primaryLabel =
    when === "later"
      ? at ? `Schedule · ${new Date(at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Schedule"
      : editing && editing.status !== "draft"
        ? "Save changes"
        : "Publish now";

  return (
    <div className="flex min-h-screen flex-wrap">
      <section aria-label="Editor" className="flex min-w-0 flex-[1_1_520px] flex-col gap-6 border-r border-ps-fg/[0.06] px-4 sm:px-8 pb-0 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="m-0 text-lg font-medium">{editing ? "Edit post" : "New post"}</h1>
          {editing && <span className="text-xs text-ps-subtle">Changes apply when you save</span>}
        </div>
        {notice && <p role="status" className="m-0 rounded-lg border border-ps-line bg-ps-surface px-3 py-2 text-[13px] text-ps-muted">{notice}</p>}

        <div>
          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Label>Post to</Label>
            {profiles.length > 0 && (
              <div role="radiogroup" aria-label="Profile" className="flex flex-wrap gap-1">
                {[{ id: "all", name: "All", color: "" }, ...profiles].map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={profileFilter === p.id} onClick={() => setProfileFilter(p.id)} className={cn("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs", profileFilter === p.id ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>
                    {p.color && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />}
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {profileFilter !== "all" && (
              <button type="button" onClick={() => setSelected((s) => [...new Set([...s, ...accounts.filter((a) => a.profileId === profileFilter).map((a) => a.id)])])} className="text-xs text-ps-plum-soft hover:text-ps-text">
                Select all in {profiles.find((p) => p.id === profileFilter)?.name}
              </button>
            )}
          </div>
          {accounts.length === 0 ? (
            <p className="m-0 text-ps-muted">
              No accounts yet. <Link href="/beta/accounts" className="text-ps-plum-soft hover:text-ps-text">Connect one</Link> first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {visible.map((a) => {
                const on = selected.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setSelected((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]));
                      if (on && tab === a.id) setTab("all");
                    }}
                    className={cn("inline-flex h-[38px] items-center gap-2.5 rounded-full border pl-1.5 pr-3 text-[13px] transition-colors", on ? "border-ps-plum/60 bg-ps-plum/[0.12] text-ps-text" : "border-ps-fg/[0.08] text-ps-subtle opacity-80 hover:opacity-100")}
                  >
                    <span className="relative">
                      <AccountMark platform={a.platform} avatarUrl={a.avatarUrl} size={26} badge={15} />
                    </span>
                    {a.platform === "youtube" || a.platform === "facebook" || a.platform === "linkedin" ? a.name : `@${a.handle}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <div role="tablist" aria-label="Caption per platform" className="flex flex-wrap gap-0.5 border-b border-ps-fg/[0.06]">
            {[{ id: "all", label: "All platforms", custom: false }, ...chosen.map((a) => ({ id: a.id, label: chosen.filter((x) => x.platform === a.platform).length > 1 ? `${NAMES[a.platform]} · ${a.handle}` : NAMES[a.platform], custom: choiceFor(a.id).caption !== undefined }))].map((t) => {
              const over = limits.some((l) => l.accountId === t.id && l.over);
              return (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("inline-flex h-[34px] items-center gap-1.5 px-3", tab === t.id ? "text-ps-text shadow-[inset_0_-2px_0_rgb(var(--ps-plum))]" : "text-ps-muted hover:text-ps-text")}>
                  {t.label}
                  {over && <span className="h-1.5 w-1.5 rounded-full bg-ps-failed" aria-label="over the limit" />}
                  {!over && t.custom && <span className="h-1.5 w-1.5 rounded-full bg-ps-plum" aria-label="own caption" />}
                </button>
              );
            })}
          </div>
          {tabAccount && (
            <div className="flex justify-between text-xs text-ps-muted">
              <span>{choiceFor(tabAccount.id).caption !== undefined ? `${NAMES[tabAccount.platform]} uses its own caption.` : `Edit to give ${NAMES[tabAccount.platform]} its own caption.`}</span>
              {choiceFor(tabAccount.id).caption !== undefined && (
                <button type="button" onClick={() => setChoice(tabAccount.id, { caption: undefined })} className="text-ps-plum-soft hover:text-ps-text">Use the shared caption</button>
              )}
            </div>
          )}
          <label htmlFor="caption" className="sr-only">Caption</label>
          <textarea
            id="caption"
            rows={7}
            value={tabAccount ? effectiveCaption(caption, choiceFor(tabAccount.id)) : caption}
            onChange={(e) => (tabAccount ? setChoice(tabAccount.id, { caption: e.target.value }) : setCaption(e.target.value))}
            placeholder="Write a caption…"
            className="w-full resize-y rounded-[10px] border border-ps-fg/10 bg-ps-surface px-4 py-3.5 text-sm leading-relaxed text-ps-text placeholder:text-ps-subtle focus:border-ps-plum/60 focus:outline-none"
          />
          {limits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {limits.map((l) => (
                <span key={l.accountId} className={cn("rounded-md px-2 py-0.5 font-mono text-[11px]", l.over ? "bg-ps-failed/[0.12] text-ps-failed-text" : "bg-ps-fg/[0.04] text-ps-muted")}>
                  {l.label} {l.used.toLocaleString("en-US")} / {l.max.toLocaleString("en-US")}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label className="mb-2.5">Media</Label>
          <div className="flex flex-wrap gap-2.5">
            {media.map((m, i) => (
              <div key={m.id} className="group relative">
                <Thumb url={m.type === "image" ? m.url : (m.poster ?? null)} isVideo={m.type === "video"} size={84} />
                {media.length > 1 && <span className="absolute left-1 top-1 rounded bg-black/60 text-white px-1 font-mono text-[10px]">{i + 1}</span>}
                {m.duration && <span className="absolute bottom-1 right-1 rounded bg-black/60 text-white px-1 font-mono text-[10px]">{Math.floor(m.duration / 60)}:{String(Math.round(m.duration % 60)).padStart(2, "0")}</span>}
                <div className="absolute inset-x-1 top-1 hidden justify-end gap-1 group-hover:flex group-focus-within:flex [@media(hover:none)]:flex">
                  {i > 0 && <button type="button" aria-label={`Move ${m.name} earlier`} onClick={() => setMediaIds((ids) => swap(ids, i, i - 1))} className="rounded bg-black/70 text-white px-1 text-[11px]">←</button>}
                  <button type="button" aria-label={`Remove ${m.name}`} onClick={() => setMediaIds((ids) => ids.filter((x) => x !== m.id))} className="rounded bg-black/70 text-white px-1 text-[11px]">✕</button>
                </div>
              </div>
            ))}
            {uploads.map((u) => (
              <UploadCard key={u.key} upload={u} onDismiss={() => dismiss(u.key)} onResume={() => resume(u.key)} className="flex h-[84px] w-[200px] flex-col justify-center gap-1.5 rounded-[10px] border border-ps-fg/[0.08] bg-ps-surface px-3" />
            ))}
            <button type="button" data-attr="add-media" onClick={() => setPicker(true)} className="h-[84px] w-[84px] rounded-[10px] border border-dashed border-ps-fg/[0.18] text-xs text-ps-muted hover:border-ps-plum/50 hover:text-ps-text">
              Add media
            </button>
            {keepOpen && <KeepOpenNote />}
          </div>
        </div>

        {chosen.length > 0 && media.some((m) => m.type === "video") && (
          <CoverPicker
            video={media.find((m) => m.type === "video")!}
            images={library.filter((m) => m.type === "image")}
            cover={cover}
            onChange={setCover}
            notes={coverNotes(chosen, choiceFor, caption, media, cover)}
            onUpload={(f) => void coverUpload.upload(f)}
            uploads={coverUpload.uploads}
          />
        )}

        {chosen.length > 0 && (
          <div className="flex flex-col gap-3">
            <Label>Options</Label>
            {chosen.map((a) => (
              <PlatformOptions
                key={a.id}
                account={a}
                choice={choiceFor(a.id)}
                media={media}
                caption={caption}
                onChange={(c) => setChoice(a.id, c)}
                creator={creator[a.id] ?? null}
                creatorError={creatorError[a.id] ?? null}
              />
            ))}
          </div>
        )}

        <div>
          <Label className="mb-2.5">When</Label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-[9px] border border-ps-fg/[0.08] bg-ps-ground p-[3px]" role="radiogroup" aria-label="When to post">
              {(
                [
                  ["now", "Now"],
                  ["later", "Schedule"],
                ] as const
              ).map(([id, text]) => (
                <button key={id} type="button" role="radio" aria-checked={when === id} onClick={() => setWhen(id)} className={cn("h-7 rounded-md px-3 text-xs", when === id ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>
                  {text}
                </button>
              ))}
            </div>
            {when === "later" && (
              <label className="flex items-center gap-2">
                <span className="sr-only">Date and time</span>
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-9 rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px] text-ps-text" />
                <span className="text-xs text-ps-subtle">your time</span>
              </label>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 -mx-4 sm:-mx-8 mt-auto flex flex-col gap-2.5 border-t border-ps-fg/[0.06] bg-ps-ground/95 px-4 sm:px-8 py-3.5 backdrop-blur">
          {directTikTok && <TikTokConsent brandedContent={brandedTikTok} />}
          {error && <p role="alert" className="m-0 text-[13px] text-ps-failed-text">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="min-w-0 flex-1 text-[13px]">
              {tried && problems.length > 0 ? (
                <ul id="composer-problems" role="alert" className="m-0 list-none space-y-1 p-0">
                  {problems.slice(0, 2).map((p) => (
                    <li key={p} className="flex gap-2 text-ps-failed-text"><span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-ps-failed" />{p}</li>
                  ))}
                  {problems.length > 2 && <li className="pl-3.5 text-ps-subtle">and {problems.length - 2} more</li>}
                </ul>
              ) : shownCheck ? (
                <span className="inline-flex items-center gap-2 text-ps-live"><span className="h-1.5 w-1.5 rounded-full bg-ps-live" />Ready for {chosen.map((a) => NAMES[a.platform]).filter((v, i, x) => x.indexOf(v) === i).join(", ")}</span>
              ) : null}
            </div>
            <div className="flex gap-2">
              {(!editing || editing.status === "draft") && (
                <button type="button" disabled={busy !== null || chosen.length === 0} onClick={() => save(false)} data-attr="save-draft" className="h-[34px] rounded-lg border border-ps-fg/[0.12] px-3.5 text-ps-text hover:border-ps-fg/25 disabled:opacity-50">
                  {busy === "draft" ? "Saving…" : "Save draft"}
                </button>
              )}
              {accounts.length === 0 ? (
                <Link href="/beta/accounts" data-attr="composer-connect-first" className="inline-flex h-[34px] items-center rounded-lg bg-ps-plum px-4 font-medium text-ps-ground hover:bg-ps-plum-hover">
                  Connect an account first
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-describedby={tried && problems.length > 0 ? "composer-problems" : undefined}
                  onClick={() => (problems.length ? setTried(true) : save(true))}
                  data-attr={when === "later" ? "schedule-post" : "publish-now"}
                  className="h-[34px] rounded-lg bg-ps-plum px-4 font-medium text-ps-ground hover:bg-ps-plum-hover disabled:cursor-not-allowed disabled:bg-ps-plum/40 disabled:text-ps-ground/80"
                >
                  {busy === "send" ? "Sending…" : primaryLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <aside aria-label="Preview" className="flex min-w-0 flex-[1_1_420px] flex-col items-center gap-4 bg-ps-sidebar px-4 sm:px-8 py-6 [background-image:linear-gradient(rgba(155,108,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(155,108,255,0.055)_1px,transparent_1px)] [background-size:48px_48px]">
        {previewAccount ? (
          <>
            <div className="flex flex-col items-center gap-4 md:sticky md:top-6">
            {chosen.length > 1 && (
              <div className="inline-flex flex-wrap rounded-[9px] border border-ps-fg/[0.08] bg-ps-ground p-[3px]" role="tablist" aria-label="Preview">
                {chosen.map((a) => (
                  <button key={a.id} type="button" role="tab" aria-selected={previewAccount.id === a.id} onClick={() => setPreviewId(a.id)} className={cn("h-7 rounded-md px-3 text-xs", previewAccount.id === a.id ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>
                    {NAMES[a.platform]}
                  </button>
                ))}
              </div>
            )}
            <div>
              <Preview
                account={previewAccount}
                media={media}
                caption={effectiveCaption(caption, choiceFor(previewAccount.id))}
                mediaType={choiceFor(previewAccount.id).mediaType ?? defaultMediaType(previewAccount.platform, media)}
                title={choiceFor(previewAccount.id).title ?? defaultTitle(caption)}
              />
            </div>
            <p className="m-0 max-w-xs text-center text-xs text-ps-subtle">Your real handle and media. Feeds may trim long captions.</p>
            </div>
          </>
        ) : (
          <p className="mt-40 max-w-xs text-center text-ps-subtle">Choose an account to see a preview.</p>
        )}
      </aside>

      {picker && <MediaPicker library={library} selected={mediaIds} onClose={() => setPicker(false)} onToggle={(id) => setMediaIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))} onFiles={(files) => { for (const f of files) void upload(f); setPicker(false); }} />}
    </div>
  );
}

const swap = (ids: string[], a: number, b: number) => {
  const next = [...ids];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
};

function PlatformOptions({ account, choice, media, caption, onChange, creator, creatorError }: { account: ComposerAccount; choice: PlatformChoice; media: ComposerMedia[]; caption: string; onChange: (c: Partial<PlatformChoice>) => void; creator: CreatorInfo | null; creatorError: string | null }) {
  const types = MEDIA_TYPES[account.platform];
  const mediaType = choice.mediaType ?? defaultMediaType(account.platform, media);
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-ps-fg/[0.08] bg-ps-surface px-4 py-3.5">
      <div className="flex items-center gap-2">
        <PlatformMark platform={account.platform} />
        <span className="font-medium">{NAMES[account.platform]}</span>
        <span className="text-ps-subtle">{account.platform === "youtube" || account.platform === "facebook" || account.platform === "linkedin" ? account.name : `@${account.handle}`}</span>
      </div>
      {types && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ps-muted">Post type</span>
          <span className="inline-flex flex-wrap rounded-[9px] border border-ps-fg/[0.08] bg-ps-ground p-[3px]" role="radiogroup" aria-label={`${NAMES[account.platform]} post type`}>
            {types.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={mediaType === t.id} onClick={() => onChange({ mediaType: t.id })} className={cn("h-7 rounded-md px-2.5 text-xs", mediaType === t.id ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>
                {t.label}
              </button>
            ))}
          </span>
        </div>
      )}
      {account.platform === "facebook" && mediaType === "link" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-ps-muted">Link</span>
          <input type="url" value={choice.link ?? ""} placeholder="https://…" onChange={(e) => onChange({ link: e.target.value })} className="h-9 rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px]" />
        </label>
      )}
      {account.platform === "youtube" && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="flex justify-between text-xs text-ps-muted">Title <span className="font-mono">{(choice.title ?? defaultTitle(caption)).length} / 100</span></span>
            <input value={choice.title ?? defaultTitle(caption)} maxLength={100} onChange={(e) => onChange({ title: e.target.value })} className="h-9 rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px]" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ps-muted">Visibility</span>
            <span className="inline-flex rounded-[9px] border border-ps-fg/[0.08] bg-ps-ground p-[3px]" role="radiogroup" aria-label="YouTube visibility">
              {(["public", "unlisted", "private"] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={(choice.privacy ?? "public") === p} onClick={() => onChange({ privacy: p })} className={cn("h-7 rounded-md px-2.5 text-xs capitalize", (choice.privacy ?? "public") === p ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>
                  {p}
                </button>
              ))}
            </span>
          </div>
        </>
      )}
      {account.platform === "linkedin" && (
        <p className="m-0 text-xs text-ps-muted">
          Posts to your LinkedIn profile as {media.some((m) => m.type === "video") ? "a video" : media.length > 1 ? "an image gallery" : media.length ? "an image post" : "a text post"}.
        </p>
      )}
      {account.platform === "bluesky" && (
        <p className="m-0 text-xs text-ps-muted">
          Posts to Bluesky as {media.some((m) => m.type === "video") ? "a video" : media.length ? `${media.length === 1 ? "an image" : `${media.length} images`}` : "a text post"}. Links, @mentions and #hashtags become clickable.
        </p>
      )}
      {account.platform === "x" && (
        <p className="m-0 text-xs text-ps-muted">
          Posts to X as {media.some((m) => m.type === "video") ? "a video" : media.length ? `${media.length === 1 ? "an image" : `${media.length} images`}` : "a text post"}. Links count as 23 characters.
        </p>
      )}
      {account.platform === "tiktok" && <TikTokOptions value={choice.tiktok ?? NEW_TIKTOK} onChange={(t) => onChange({ tiktok: t })} info={creator} infoError={creatorError} accountName={account.name} photo={isTikTokPhotoPost(media)} />}
    </div>
  );
}

function MediaPicker({ library, selected, onClose, onToggle, onFiles }: { library: ComposerMedia[]; selected: string[]; onClose: () => void; onToggle: (id: string) => void; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div role="dialog" aria-modal="true" aria-label="Add media" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-ps-fg/10 bg-ps-dialog shadow-[0_24px_60px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ps-fg/[0.06] px-4 py-3.5 sm:px-5">
          <h2 className="m-0 text-sm font-medium">Add media</h2>
          <div className="flex items-center gap-2">
            <Link href="/beta/media" className="px-2 text-xs text-ps-subtle hover:text-ps-text">Manage library</Link>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple className="sr-only" onChange={(e) => onFiles(Array.from(e.target.files ?? []))} />
            <button type="button" data-attr="upload-media" onClick={() => input.current?.click()} className="h-8 rounded-lg bg-ps-plum px-3.5 font-medium text-ps-ground hover:bg-ps-plum-hover">Upload</button>
            <button type="button" onClick={onClose} className="h-8 rounded-lg border border-ps-fg/[0.12] px-3">Done</button>
          </div>
        </div>
        <div className="grid gap-3 overflow-y-auto p-5 [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
          {library.length === 0 && <p className="col-span-full m-0 py-10 text-center text-ps-muted">Your library is empty. Upload a photo or video.</p>}
          {library.map((m) => {
            const on = selected.includes(m.id);
            return (
              <button key={m.id} type="button" aria-pressed={on} onClick={() => onToggle(m.id)} className={cn("rounded-xl border p-1.5 text-left", on ? "border-ps-plum/70 bg-ps-plum/[0.1]" : "border-ps-fg/[0.06] bg-ps-surface hover:border-ps-fg/20")}>
                <span className="relative block aspect-square overflow-hidden rounded-lg bg-ps-raised">
                  {m.url && m.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed link
                    <img src={m.url} alt="" className="h-full w-full object-cover" />
                  ) : m.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed link
                    <img src={m.poster} alt="" className="h-full w-full object-cover" />
                  ) : m.url ? (
                    <video src={m.url} muted preload="metadata" className="h-full w-full object-cover" />
                  ) : null}
                  {on && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ps-plum text-[11px] text-ps-ground">{selected.indexOf(m.id) + 1}</span>}
                </span>
                <span className="mt-1.5 block truncate text-xs">{m.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Finished({ done }: { done: Done }) {
  const scheduled = done.status === "scheduled";
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 sm:px-8 py-24 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-ps-live/40 bg-ps-live/[0.12] text-xl text-ps-live">✓</span>
      <h1 className="m-0 text-lg font-medium">{done.status === "draft" ? "Draft saved" : scheduled ? "Scheduled" : "Publishing now"}</h1>
      <p className="m-0 text-ps-muted">
        {done.status === "draft"
          ? "It's in your drafts. You or your AI can finish it any time."
          : scheduled && done.scheduledAt
            ? `It goes out ${new Date(done.scheduledAt).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}.`
            : "Live links show up on Home as each platform confirms."}
      </p>
      {done.tiktokDirect && <p className="m-0 rounded-lg border border-ps-fg/[0.08] bg-ps-surface px-4 py-3 text-[13px] text-ps-muted">Your TikTok may take a few minutes to process before it appears on your profile.</p>}
      <div className="mt-2 flex gap-2">
        {done.status === "draft" ? (
          <Link href="/beta/drafts" className="inline-flex h-9 items-center rounded-lg border border-ps-fg/[0.12] px-4 hover:border-ps-fg/25">Go to Drafts</Link>
        ) : (
          <Link href="/beta" className="inline-flex h-9 items-center rounded-lg border border-ps-fg/[0.12] px-4 hover:border-ps-fg/25">Go to Home</Link>
        )}
        <a href="/beta/create" className="inline-flex h-9 items-center rounded-lg bg-ps-plum px-4 font-medium text-ps-ground hover:bg-ps-plum-hover">Create another</a>
      </div>
    </div>
  );
}
