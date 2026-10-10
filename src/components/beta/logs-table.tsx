"use client";

import { useState } from "react";
import type { LogRow } from "@/lib/beta/logs";
import { SOURCES } from "@/lib/beta/logs";
import { cn } from "@/lib/utils";
import { LocalTime } from "./local-time";
import { ActorMark } from "./marks";
import { PlatformMark, Status } from "./ui";

const LEVEL = {
  error: { dot: "bg-ps-failed", label: "Error" },
  warning: { dot: "bg-ps-attention", label: "Warning" },
  info: { dot: "bg-white/25", label: "OK" },
} as const;

// One line per event; open a line for the reason a failure gave and the raw details.
export function LogsTable({ rows }: { rows: LogRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <p className="m-0 px-4 py-10 text-center text-ps-muted">Nothing matches these filters.</p>;
  return (
    <div role="table" aria-label="Logs" className="text-[13px]">
      <div role="row" className="hidden grid-cols-[150px_minmax(0,1fr)_110px_160px] gap-3 border-b border-white/[0.06] px-4 py-2 text-[11px] uppercase tracking-wide text-ps-subtle md:grid">
        <span role="columnheader">Time</span>
        <span role="columnheader">Event</span>
        <span role="columnheader">Source</span>
        <span role="columnheader">By</span>
      </div>
      {rows.map((r) => {
        const expanded = open === r.id;
        return (
          <div key={r.id} role="row" className={cn("border-b border-white/[0.04]", r.level === "error" && "bg-ps-failed/[0.04]")}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : r.id)}
              className="grid w-full grid-cols-1 gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-white/[0.02] md:grid-cols-[150px_minmax(0,1fr)_110px_160px] md:items-center"
            >
              <span role="cell" className="flex items-center gap-2 font-mono text-xs text-ps-subtle">
                <span className={cn("h-1.5 w-1.5 flex-none rounded-full", LEVEL[r.level].dot)} aria-label={LEVEL[r.level].label} />
                <LocalTime iso={r.at} style="when" />
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                {r.target && <PlatformMark platform={r.target.platform} size={16} className="flex-none rounded-[5px]" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.summary}</span>
                  {r.error && <span className="block truncate text-xs text-[#FF8A8E]">{r.error.message}</span>}
                </span>
                {r.status && <Status tone={r.status.tone} label={r.status.label} />}
              </span>
              <span role="cell" className="text-xs text-ps-muted">{SOURCES[r.source] ?? r.source}</span>
              <span role="cell" className="flex min-w-0 items-center gap-2 text-xs text-ps-muted">
                <ActorMark kind={r.actorKind} name={r.actorName} size={18} />
                <span className="truncate" title={r.actorVia ? `${r.actorName}, using ${r.actorVia}` : undefined}>{r.actorName}</span>
              </span>
            </button>
            {expanded && (
              <div className="flex flex-col gap-2.5 px-4 pb-4 md:pl-[178px]">
                <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-ps-subtle">Event</dt>
                  <dd className="m-0 font-mono">{r.eventType}</dd>
                  {r.target && (
                    <>
                      <dt className="text-ps-subtle">Account</dt>
                      <dd className="m-0">{r.target.account || r.target.platform}</dd>
                    </>
                  )}
                  {r.error && (
                    <>
                      <dt className="text-ps-subtle">Reason</dt>
                      <dd className="m-0 whitespace-pre-wrap break-words text-[#FF8A8E]">{r.error.message}</dd>
                    </>
                  )}
                  {r.error?.code && (
                    <>
                      <dt className="text-ps-subtle">Code</dt>
                      <dd className="m-0 font-mono">{r.error.code}</dd>
                    </>
                  )}
                  <dt className="text-ps-subtle">Log id</dt>
                  <dd className="m-0 select-all font-mono text-ps-subtle">{r.id}</dd>
                </dl>
                {r.details && <pre className="m-0 max-h-64 overflow-auto rounded-lg border border-white/[0.06] bg-ps-ground p-3 font-mono text-[11px] leading-relaxed text-ps-muted">{JSON.stringify(r.details, null, 2)}</pre>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
