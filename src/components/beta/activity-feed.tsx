"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ActivityRow } from "@/lib/beta/home";
import { cn } from "@/lib/utils";
import { LocalTime } from "./local-time";
import { ActorMark, type ActorKind } from "./marks";
import { Label, Status } from "./ui";

const subscribe = () => () => {};

// Activity written as sentences ("Claude scheduled a post for Instagram via MCP"), grouped
// by day in the viewer's time zone, filterable by who did it.
export function ActivityFeed({
  rows,
  actors,
  filterPath,
  activeActor,
}: {
  rows: ActivityRow[];
  actors: Array<{ id: string; kind: ActorKind; display_name: string }>;
  // When set, filter pills are links to this page (the Activity page filters on the
  // server). A path, not a function: functions can't cross from server to client.
  filterPath?: string;
  activeActor?: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const filterHref = filterPath ? (actorId: string | null) => (actorId ? `${filterPath}?who=${actorId}` : filterPath) : undefined;
  const who = filterHref ? (activeActor ?? null) : picked;
  const local = useSyncExternalStore(subscribe, () => true, () => false);

  const shown = filterHref || !who ? rows : rows.filter((r) => r.actorId === who);
  const groups = useMemo(() => {
    const out: Array<{ key: string; iso: string; rows: ActivityRow[] }> = [];
    for (const row of shown) {
      const key = local ? new Date(row.at).toDateString() : row.at.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else out.push({ key, iso: row.at, rows: [row] });
    }
    return out;
  }, [shown, local]);

  // People first, then AI apps and keys, the ones with activity here.
  const seen = new Set(rows.map((r) => r.actorId));
  const filters = actors.filter((a) => seen.has(a.id) || a.id === who).sort((a, b) => (a.kind === "user" ? -1 : b.kind === "user" ? 1 : a.display_name.localeCompare(b.display_name)));

  const pill = (active: boolean) =>
    cn("inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors", active ? "border-ps-plum/50 bg-ps-plum/[0.14] text-ps-text" : "border-white/[0.08] text-ps-muted hover:text-ps-text");

  return (
    <div>
      {filters.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] px-4 py-3" role="toolbar" aria-label="Filter by who">
          {filterHref ? (
            <>
              <Link href={filterHref(null)} className={pill(!who)} aria-current={!who ? "true" : undefined}>Everyone</Link>
              {filters.map((a) => (
                <Link key={a.id} href={filterHref(a.id)} className={pill(who === a.id)} aria-current={who === a.id ? "true" : undefined}>
                  <ActorMark kind={a.kind} name={a.display_name} size={16} />
                  {a.display_name}
                </Link>
              ))}
            </>
          ) : (
            <>
              <button type="button" onClick={() => setPicked(null)} className={pill(!who)} aria-pressed={!who}>Everyone</button>
              {filters.map((a) => (
                <button key={a.id} type="button" onClick={() => setPicked(a.id)} className={pill(who === a.id)} aria-pressed={who === a.id}>
                  <ActorMark kind={a.kind} name={a.display_name} size={16} />
                  {a.display_name}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="px-4 py-8 text-center text-ps-muted">Nothing here yet.</p>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <Label className="border-b border-white/[0.04] px-4 pb-1.5 pt-3">{local ? <LocalTime iso={g.iso} style="day" /> : g.iso.slice(0, 10)}</Label>
            {g.rows.map((r) => (
              <div key={r.id} className="flex min-h-10 items-center gap-2.5 border-b border-white/[0.04] px-4 py-1.5">
                <ActorMark kind={r.actorKind} name={r.actorName} />
                <span className="min-w-0 flex-1 leading-relaxed">
                  <strong className="font-medium">{r.actorName}</strong>{" "}
                  <span className="text-ps-muted">{r.sentence}</span>
                  {r.via && <span className="text-ps-subtle"> {r.via}</span>}
                </span>
                {r.status && <Status tone={r.status.tone} label={r.status.label} />}
                <LocalTime iso={r.at} style="time" className="w-16 flex-none text-right font-mono text-xs text-ps-subtle" />
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
