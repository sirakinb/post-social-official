"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";

export type FilterValues = { level: "all" | "errors"; area: string | null; source: string | null; who: string | null };
type Option = { value: string; label: string };

// One fixed row on top of the logs: a two-way status switch, then a dropdown per filter.
// Each change loads the page again with the new filters (paging starts over).
export function LogsFilters(props: { values: FilterValues; areas: Option[]; sources: Option[]; people: Option[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (change: Partial<FilterValues>) => {
    const merged = { ...props.values, ...change };
    const qs = new URLSearchParams();
    if (merged.level === "errors") qs.set("level", "errors");
    if (merged.area) qs.set("area", merged.area);
    if (merged.source) qs.set("source", merged.source);
    if (merged.who) qs.set("who", merged.who);
    const query = qs.toString();
    startTransition(() => router.push(`/beta/activity${query ? `?${query}` : ""}`));
  };
  const filtered = props.values.level === "errors" || props.values.area || props.values.source || props.values.who;

  return (
    <div role="toolbar" aria-label="Filter logs" aria-busy={pending} className={cn("flex flex-col border-b border-ps-fg/[0.06] md:h-11 md:flex-row md:items-stretch", pending && "opacity-70")}>
      <div className="flex items-center gap-0.5 border-b border-ps-fg/[0.06] px-2 py-1.5 md:border-b-0 md:border-r md:py-0" role="radiogroup" aria-label="Status">
        {(["all", "errors"] as const).map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={props.values.level === level}
            onClick={() => go({ level })}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs",
              props.values.level === level ? "bg-ps-fg/[0.08] text-ps-text" : "text-ps-subtle hover:text-ps-text",
            )}
          >
            {level === "errors" && <span className="h-1.5 w-1.5 rounded-full bg-ps-failed" />}
            {level === "all" ? "All" : "Errors"}
          </button>
        ))}
      </div>
      <Select label="Area" value={props.values.area} empty="All" options={props.areas} onChange={(area) => go({ area })} />
      <Select label="Source" value={props.values.source} empty="Any" options={props.sources} onChange={(source) => go({ source })} />
      {props.people.length > 1 && <Select label="Person" value={props.values.who} empty="Anyone" options={props.people} onChange={(who) => go({ who })} wide />}
      <span className="hidden flex-1 md:block" />
      {filtered && (
        <button type="button" onClick={() => go({ level: "all", area: null, source: null, who: null })} className="px-4 py-2 text-left text-xs text-ps-subtle hover:text-ps-text md:py-0">
          Reset
        </button>
      )}
    </div>
  );
}

function Select(props: { label: string; value: string | null; empty: string; options: Option[]; onChange: (value: string | null) => void; wide?: boolean }) {
  return (
    <label className={cn("flex min-w-0 items-center gap-2 border-b border-ps-fg/[0.06] px-4 py-2 md:border-b-0 md:border-r md:py-0", props.wide ? "md:w-[220px]" : "md:w-[170px]")}>
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ps-subtle">{props.label}</span>
      <select
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value || null)}
        className="min-w-0 flex-1 cursor-pointer truncate bg-transparent text-xs text-ps-text outline-none"
      >
        <option value="">{props.empty}</option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
