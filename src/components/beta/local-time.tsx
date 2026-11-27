"use client";

import { useSyncExternalStore } from "react";

// Times in the viewer's own time zone. The server doesn't know it, so the server renders a
// neutral UTC form and the browser swaps in the local one.
const subscribe = () => () => {};

function format(iso: string, style: "time" | "when" | "day") {
  const d = new Date(iso);
  if (style === "time") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (style === "day") {
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  const today = new Date().toDateString() === d.toDateString();
  const tomorrow = new Date(Date.now() + 86_400_000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (today) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  if (Math.abs(d.getTime() - Date.now()) < 6 * 86_400_000) return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

// The whole moment with the zone's name ("Thu, Nov 26, 2026, 8:56 PM EST"), for the hover
// text: the short form on the page leaves the zone out.
export function fullLocal(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

export function LocalTime({ iso, style = "when", className }: { iso: string; style?: "time" | "when" | "day"; className?: string }) {
  const local = useSyncExternalStore(subscribe, () => format(iso, style), () => null);
  const full = useSyncExternalStore(subscribe, () => fullLocal(iso), () => null);
  const fallback = style === "day" ? iso.slice(0, 10) : new Date(iso).toISOString().slice(11, 16) + " UTC";
  return (
    <time dateTime={iso} title={full ?? undefined} className={className} suppressHydrationWarning>
      {local ?? fallback}
    </time>
  );
}
