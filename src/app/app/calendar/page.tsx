"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, Plus, CircleCheck, Eye, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace-provider";
import { demoPosts } from "@/lib/demo";
import { api } from "../../../../convex/_generated/api";

type CalendarState = "ready" | "review" | "scheduled";
type CalendarEvent = { id: string; at: Date; time: string; title: string; state: CalendarState; channels: string };

const channelAbbreviation = { tiktok: "TT", instagram: "IG", facebook: "FB", threads: "TH", youtube: "YT" } as const;

function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month, index - first.getDay() + 1);
    return { date, currentMonth: date.getMonth() === month };
  });
}

function calendarState(status: string): CalendarState {
  if (status === "awaiting_approval" || status === "draft") return "review";
  if (status === "published") return "ready";
  return "scheduled";
}

export default function CalendarPage() {
  const workspace = useWorkspace();
  const livePosts = useQuery(api.posts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const cells = useMemo(() => monthCells(year, month), [year, month]);

  const events = useMemo<CalendarEvent[]>(() => {
    if (workspace.mode === "live") {
      return (livePosts ?? []).flatMap((post) => {
        if (!post.scheduledAt) return [];
        const at = new Date(post.scheduledAt);
        return [{
          id: post._id,
          at,
          time: post.status === "awaiting_approval" ? "Needs approval" : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          title: post.caption || "Untitled post",
          state: calendarState(post.status),
          channels: post.destinations.map((destination) => channelAbbreviation[destination.platform]).join(" · "),
        }];
      });
    }
    return demoPosts.flatMap((post) => {
      if (!post.scheduledAt) return [];
      const at = new Date(post.scheduledAt);
      return [{ id: post.id, at, time: at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), title: post.caption, state: calendarState(post.status), channels: post.results.map((result) => channelAbbreviation[result.platform]).join(" · ") }];
    });
  }, [livePosts, workspace.mode]);

  const currentEvents = events.filter((event) => event.at.getFullYear() === year && event.at.getMonth() === month);
  const eventsByDay = currentEvents.reduce<Record<number, CalendarEvent[]>>((result, event) => {
    (result[event.at.getDate()] ??= []).push(event);
    return result;
  }, {});
  const today = new Date();
  const monthLabel = visibleMonth.toLocaleDateString([], { month: "long", year: "numeric" });

  function moveMonth(offset: number) { setVisibleMonth(new Date(year, month + offset, 1)); }

  return (
    <div className="space-y-8 pb-10">
      <header className="stage-enter flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="utility-label text-accent">Post Social / Schedule</p>
          <h1 className="mt-3 font-sans text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em]">Calendar<span className="scanline-accent">.</span></h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-ink-muted">See what is scheduled, what is waiting for approval, and what is ready to go.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3"><div className="mr-4"><p className="text-4xl font-semibold tracking-[-0.06em]">{currentEvents.length}</p><p className="utility-label text-ink-subtle">this month</p></div><Button asChild variant="primary" size="lg"><Link href="/app/create"><Plus className="h-5 w-5" />Create a post</Link></Button></div>
      </header>

      <section className="grooved-surface stage-enter-delayed overflow-hidden rounded-xl border border-border bg-surface/95 shadow-hairline">
        <div className="flex flex-col gap-4 border-b border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4"><h2 className="text-2xl font-semibold tracking-[-0.03em]">{monthLabel}</h2><span className="utility-label hidden text-ink-subtle sm:inline">Your local time</span></div>
          <div className="flex items-center gap-2"><Button variant="secondary" size="icon" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button><Button variant="secondary" onClick={() => setVisibleMonth(new Date())}>Today</Button><Button variant="secondary" size="icon" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight className="h-4 w-4" /></Button></div>
        </div>

        <div className="hidden grid-cols-7 border-b border-border md:grid">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <div key={day} className="border-r border-border px-3 py-3 text-xs font-bold uppercase tracking-[0.18em] text-ink-subtle last:border-r-0">{day}</div>)}</div>
        <div role="grid" aria-label={`Month view for ${monthLabel}`} className="hidden grid-cols-7 md:grid">{cells.map(({ date, currentMonth }, index) => {
          const isToday = currentMonth && date.toDateString() === today.toDateString();
          const dayEvents = currentMonth ? eventsByDay[date.getDate()] ?? [] : [];
          return <div key={`${index}-${date.toISOString()}`} className={`min-h-[120px] border-b border-r border-border p-3 xl:min-h-[150px] [&:nth-child(7n)]:border-r-0 ${isToday ? "bg-surface-raised/60" : ""}`}><span className={`inline-flex h-8 min-w-8 items-center justify-center text-sm font-bold ${isToday ? "bg-accent px-2 text-white" : currentMonth ? "" : "text-ink-subtle"}`}>{date.getDate()}</span><div className="mt-3 space-y-2">{dayEvents.map((event) => <article key={event.id} className={`border-l-[3px] bg-canvas px-3 py-2 text-ink ${event.state === "ready" ? "border-success" : event.state === "review" ? "border-warning border-dashed" : "border-accent"}`}><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{event.state === "ready" ? <CircleCheck className="h-3 w-3" /> : event.state === "review" ? <Eye className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}{event.time}</div><p className="mt-1 line-clamp-2 text-xs font-semibold leading-4">{event.title}</p><p className="mt-1 text-[10px] font-bold text-ink-subtle">{event.channels}</p></article>)}</div></div>;
        })}</div>
        {currentEvents.length === 0 ? <p className="hidden px-6 py-4 text-center text-sm text-ink-muted md:block">Nothing scheduled this month. Choose a date when you create your next post.</p> : null}

        <div className="divide-y divide-border md:hidden">{currentEvents.sort((a, b) => a.at.getTime() - b.at.getTime()).map((event) => <div key={event.id} className="grid grid-cols-[48px_1fr] gap-4 p-4"><span className="text-2xl font-semibold">{event.at.getDate()}</span><div><p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">{event.time} · {event.channels}</p><p className="mt-1 text-lg font-semibold">{event.title}</p></div></div>)}{currentEvents.length === 0 ? <div className="p-10 text-center"><p className="font-medium text-ink">Nothing scheduled this month.</p><p className="mt-2 text-sm text-ink-muted">Choose a date when you create your next post.</p></div> : null}</div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3"><div className="grooved-surface rounded-xl border border-success/20 bg-success-bg p-5"><p className="utility-label text-success">Published</p><p className="mt-2 text-xl font-semibold">Confirmed live</p></div><div className="grooved-surface rounded-xl border border-warning/20 bg-warning-bg p-5"><p className="utility-label text-warning">Review</p><p className="mt-2 text-xl font-semibold">Waiting for your eye</p></div><div className="grooved-accent rounded-xl border border-accent p-5 text-white"><p className="utility-label text-white/60">Scheduled</p><p className="mt-2 text-xl font-semibold">Set for its moment</p></div></div>
    </div>
  );
}
