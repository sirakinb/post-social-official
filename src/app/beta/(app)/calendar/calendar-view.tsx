"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ActorMark, type ActorKind } from "@/components/beta/marks";
import { Label, PlatformMark, Status, Thumb, type Tone } from "@/components/beta/ui";
import { cn } from "@/lib/utils";
import { cancel, reschedule } from "./actions";

export type CalendarPost = {
  id: string;
  status: string;
  caption: string;
  at: string;
  scheduled: boolean;
  by: { kind: string; name: string } | null;
  via: string;
  thumb: { url: string | null; isVideo: boolean } | null;
  destinations: Array<{ platform: string; status: string; account: string; liveUrl: string | null }>;
};

const subscribe = () => () => {};
const DAY = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function statusOf(p: CalendarPost): { tone: Tone; label: string; bar: string } {
  switch (p.status) {
    case "published":
      return { tone: "live", label: "Live", bar: "#3DD68C" };
    case "partially_published":
      return { tone: "attention", label: "Partly live", bar: "#F5B54A" };
    case "failed":
      return { tone: "failed", label: "Failed", bar: "#F2555A" };
    case "processing":
      return { tone: "attention", label: "Publishing", bar: "#F5B54A" };
    case "cancelled":
      return { tone: "quiet", label: "Cancelled", bar: "#6E6784" };
    case "awaiting_approval":
      return { tone: "attention", label: "Waiting", bar: "#F5B54A" };
    default:
      return { tone: "scheduled", label: "Scheduled", bar: "#9B6CFF" };
  }
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const mondayOf = (t: number) => {
  const d = new Date(startOfDay(t));
  const shift = (d.getDay() + 6) % 7;
  return d.getTime() - shift * DAY;
};
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function CalendarView({ posts, anchor, canEdit }: { posts: CalendarPost[]; anchor: string; canEdit: boolean }) {
  const router = useRouter();
  // The current minute, read outside render (0 on the server, where the view isn't drawn).
  const minute = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 60_000), () => 0);
  const ready = minute > 0;
  const [view, setView] = useState<"week" | "2w" | "list">("2w");
  const [offset, setOffset] = useState(0); // in weeks from the anchor's week
  const [open, setOpen] = useState<string | null>(null);

  const start = mondayOf(Date.parse(anchor)) + offset * 7 * DAY;
  const days = view === "week" ? 7 : 14;
  const range = { start, end: start + days * DAY };
  const shown = useMemo(() => posts.filter((p) => Date.parse(p.at) >= range.start && Date.parse(p.at) < range.end).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [posts, range.start, range.end]);
  const counts = { scheduled: shown.filter((p) => ["scheduled", "approved"].includes(p.status)).length, live: shown.filter((p) => p.status === "published").length };
  const selected = posts.find((p) => p.id === open) ?? null;

  if (!ready) return <div className="p-8 text-ps-subtle">Loading your calendar…</div>;

  const today = startOfDay(minute * 60_000);
  const title = `${new Date(range.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(range.end - DAY).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Outside the loaded window: ask the server for posts around the new dates.
  const goTo = (weeks: number) => {
    const target = start + weeks * 7 * DAY;
    if (Math.abs(target - Date.parse(anchor)) > 35 * DAY) router.push(`/beta/calendar?from=${new Date(target).toISOString().slice(0, 10)}`);
    else setOffset(offset + weeks);
  };

  return (
    <div className="flex flex-col gap-4 px-8 pb-12 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-lg font-medium">{title}</h1>
          <span className="text-ps-subtle">{counts.scheduled} scheduled · {counts.live} live</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex">
            <button type="button" aria-label="Earlier" onClick={() => goTo(-1)} className="h-[30px] rounded-l-lg border border-white/[0.08] px-2.5 text-ps-muted hover:text-ps-text">‹</button>
            <button type="button" onClick={() => setOffset(0)} className="h-[30px] border-y border-white/[0.08] px-3 text-xs text-ps-muted hover:text-ps-text">Today</button>
            <button type="button" aria-label="Later" onClick={() => goTo(1)} className="h-[30px] rounded-r-lg border border-white/[0.08] px-2.5 text-ps-muted hover:text-ps-text">›</button>
          </div>
          <span className="font-mono text-[11px] text-ps-subtle">{tz}</span>
          <div className="inline-flex rounded-[9px] border border-white/[0.08] bg-ps-surface p-[3px]" role="radiogroup" aria-label="View">
            {(
              [
                ["week", "Week"],
                ["2w", "2 weeks"],
                ["list", "List"],
              ] as const
            ).map(([id, text]) => (
              <button key={id} type="button" role="radio" aria-checked={view === id} onClick={() => setView(id)} className={cn("h-[26px] rounded-md px-3 text-xs", view === id ? "bg-[#2A2142] text-ps-text" : "text-ps-muted hover:text-ps-text")}>
                {text}
              </button>
            ))}
          </div>
          {canEdit && <Link href="/beta/create" className="inline-flex h-[30px] items-center rounded-lg bg-ps-plum px-3 font-medium text-ps-ground hover:bg-[#AD86FF]">New post</Link>}
        </div>
      </div>

      {view === "list" ? (
        <div className="rounded-xl border border-ps-line bg-ps-surface">
          {shown.length === 0 && <p className="m-0 px-4 py-10 text-center text-ps-muted">Nothing in these dates. Ask your AI to schedule a week of posts.</p>}
          {groupByDay(shown).map((g) => (
            <div key={g.day}>
              <Label className="border-b border-white/[0.04] px-4 pb-1.5 pt-3">{dayLabel(g.day, today)}</Label>
              {g.posts.map((p) => (
                <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="flex w-full items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-left hover:bg-white/[0.02]">
                  <span className="w-16 flex-none font-mono text-xs text-ps-muted">{time(p.at)}</span>
                  <Thumb url={p.thumb?.url ?? null} isVideo={p.thumb?.isVideo ?? false} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.caption || "No caption"}</span>
                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ps-subtle">
                      {/* Each account with its platform's logo: one brand often has the same name everywhere. */}
                      {p.destinations.map((d, i) => (
                        <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
                          <PlatformMark platform={d.platform} size={16} className="rounded-[5px]" />
                          <span className="truncate">{d.account}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                  <Status tone={statusOf(p).tone} label={statusOf(p).label} />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ps-line">
          <div className="grid min-w-[840px] [grid-template-columns:repeat(7,minmax(0,1fr))]">
            {WEEKDAYS.map((w) => <Label key={w} className="border-b border-white/[0.06] bg-ps-surface px-3 py-2.5">{w}</Label>)}
            {Array.from({ length: days }, (_, i) => {
              const dayStart = new Date(range.start + i * DAY + 12 * 3600_000);
              const key = startOfDay(dayStart.getTime());
              const items = shown.filter((p) => startOfDay(Date.parse(p.at)) === key);
              const isToday = key === today;
              const weekend = i % 7 >= 5;
              return (
                <div key={key} className={cn("min-h-[128px] border-b border-r border-white/[0.05] p-2", weekend ? "bg-[#0E0A1A]" : "bg-ps-ground", key < today && "opacity-70", isToday && "shadow-[inset_0_2px_0_#9B6CFF]")}>
                  <div className="mb-1.5 flex items-center justify-between">
                    {isToday ? <span className="text-[11px] text-ps-plum-soft">Today</span> : <span />}
                    <span className={cn("font-mono text-[11px]", isToday ? "rounded-full bg-ps-plum px-1.5 text-ps-ground" : "text-ps-subtle")}>{dayStart.getDate()}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {items.slice(0, 4).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setOpen(p.id)}
                        className={cn("flex h-[26px] w-full items-center gap-1.5 rounded-md border bg-ps-raised px-1.5 text-left text-xs text-[#E9E4F5]", open === p.id ? "border-ps-plum/70" : "border-white/[0.06] hover:border-white/20")}
                        style={{ boxShadow: `inset 2px 0 0 ${statusOf(p).bar}` }}
                        title={`${time(p.at)} · ${p.caption}`}
                      >
                        <PlatformMark platform={p.destinations[0]?.platform ?? "instagram"} size={16} className="rounded-[5px]" />
                        <span className="font-mono text-[11px] text-ps-muted">{time(p.at).replace(/ (AM|PM)/, (m) => m.trim().toLowerCase()[0])}</span>
                        <span className="min-w-0 flex-1 truncate">{p.caption || "No caption"}</span>
                        {p.destinations.length > 1 && <span className="font-mono text-[10px] text-ps-subtle">+{p.destinations.length - 1}</span>}
                      </button>
                    ))}
                    {items.length > 4 && <button type="button" onClick={() => setView("list")} className="text-left text-[11px] text-ps-subtle hover:text-ps-text">+{items.length - 4} more</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && <PostCard post={selected} canEdit={canEdit} onClose={() => setOpen(null)} />}
    </div>
  );
}

function groupByDay(posts: CalendarPost[]) {
  const out: Array<{ day: number; posts: CalendarPost[] }> = [];
  for (const p of posts) {
    const day = startOfDay(Date.parse(p.at));
    const last = out[out.length - 1];
    if (last?.day === day) last.posts.push(p);
    else out.push({ day, posts: [p] });
  }
  return out;
}

function dayLabel(day: number, today: number) {
  const d = new Date(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return day === today ? `Today · ${d}` : day === today + DAY ? `Tomorrow · ${d}` : d;
}

function PostCard({ post, canEdit, onClose }: { post: CalendarPost; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState(toLocalInput(post.at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const s = statusOf(post);
  const editable = canEdit && ["scheduled", "approved", "awaiting_approval"].includes(post.status);

  async function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const r = await run();
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That didn't work. Try again.");
    onClose();
    router.refresh();
  }

  return (
    <div role="dialog" aria-label="Post" className="fixed bottom-6 right-6 z-40 w-[360px] overflow-hidden rounded-2xl border border-white/10 bg-[#161126] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
      <div className="flex items-start gap-3 p-4">
        <Thumb url={post.thumb?.url ?? null} isVideo={post.thumb?.isVideo ?? false} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-ps-muted">{new Date(post.at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            <Status tone={s.tone} label={s.label} />
          </div>
          <p className="m-0 mt-1.5 line-clamp-3 leading-snug">{post.caption || "No caption"}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-white/[0.06] px-4 py-3">
        {post.destinations.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <PlatformMark platform={d.platform} size={18} />
            <span className="min-w-0 flex-1 truncate">{d.account}</span>
            {d.liveUrl?.startsWith("https://") ? <a href={d.liveUrl} target="_blank" rel="noreferrer" className="text-ps-plum-soft hover:text-ps-text">View live ↗</a> : <span className="text-ps-subtle">{d.status.replace("_", " ")}</span>}
          </div>
        ))}
        {post.by && (
          <div className="mt-1 flex items-center gap-2 text-xs text-ps-subtle">
            <ActorMark kind={post.by.kind as ActorKind} name={post.by.name} size={16} />
            {post.scheduled ? "Scheduled" : "Posted"} by {post.by.name}{post.via === "mcp" ? " via MCP" : post.via === "api" ? " via the API" : ""}
          </div>
        )}
      </div>
      {moving && (
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-3">
          <label className="sr-only" htmlFor="move-to">New time</label>
          <input id="move-to" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-8 flex-1 rounded-lg border border-ps-line-strong bg-ps-ground px-2 text-[13px] [color-scheme:dark]" />
          <button type="button" disabled={busy} onClick={() => act(() => reschedule(post.id, new Date(when).toISOString()))} className="h-8 rounded-lg bg-ps-plum px-3 font-medium text-ps-ground disabled:opacity-60">Move</button>
        </div>
      )}
      {error && <p role="alert" className="m-0 px-4 pb-2 text-xs text-[#FF8A8E]">{error}</p>}
      <div className="flex gap-2 border-t border-white/[0.06] px-4 py-3">
        {editable && <Link href={`/beta/create?post=${post.id}`} className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-ps-plum font-medium text-ps-ground hover:bg-[#AD86FF]">Edit</Link>}
        {editable && post.status === "scheduled" && !moving && (
          <button type="button" onClick={() => setMoving(true)} className="h-8 flex-1 rounded-lg border border-white/[0.12] hover:border-white/25">Move</button>
        )}
        {editable && (confirmCancel ? (
          <button type="button" disabled={busy} onClick={() => act(() => cancel(post.id))} className="h-8 flex-1 rounded-lg border border-ps-failed/40 text-[#FF8A8E]">Confirm cancel</button>
        ) : (
          <button type="button" onClick={() => setConfirmCancel(true)} className="h-8 flex-1 rounded-lg border border-white/[0.12] text-[#FF8A8E] hover:border-ps-failed/40">Cancel post</button>
        ))}
        <button type="button" onClick={onClose} className="h-8 rounded-lg px-3 text-ps-subtle hover:text-ps-text">Close</button>
      </div>
    </div>
  );
}
