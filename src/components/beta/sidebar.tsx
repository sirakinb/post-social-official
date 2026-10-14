"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { forgetViewer } from "@/components/analytics/identify";
import type { Theme } from "@/lib/beta/theme";
import { ActorMark } from "./marks";
import { ThemeToggle } from "./theme-toggle";

type Item = { href: string; label: string; icon: React.ReactNode; match: (path: string) => boolean };

const icon = (d: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

// One flat list, in the order people use it. Media lives inside Create's picker; Stats
// returns once the platforms approve analytics.
const ITEMS: Item[] = [
  { href: "/beta/accounts", label: "Accounts", match: (p) => p === "/beta" || p.startsWith("/beta/accounts"), icon: icon(<><path d="M9 7H7a5 5 0 0 0 0 10h2" /><path d="M15 7h2a5 5 0 0 1 0 10h-2" /><path d="M8 12h8" /></>) },
  { href: "/beta/create", label: "Create", match: (p) => p.startsWith("/beta/create") || p.startsWith("/beta/media"), icon: icon(<><path d="M12 5v14" /><path d="M5 12h14" /></>) },
  { href: "/beta/drafts", label: "Drafts", match: (p) => p.startsWith("/beta/drafts"), icon: icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>) },
  { href: "/beta/calendar", label: "Calendar", match: (p) => p.startsWith("/beta/calendar"), icon: icon(<><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>) },
  { href: "/beta/activity", label: "Logs", match: (p) => p.startsWith("/beta/activity"), icon: icon(<path d="M3 12h4l3-8 4 16 3-8h4" />) },
  { href: "/beta/api", label: "API/MCP", match: (p) => p.startsWith("/beta/api") || p.startsWith("/beta/keys"), icon: icon(<><path d="m8 8-5 4 5 4" /><path d="m16 8 5 4-5 4" /><path d="m13.5 5-3 14" /></>) },
  { href: "/beta/usage", label: "Usage", match: (p) => p.startsWith("/beta/usage"), icon: icon(<><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 12h-9V3" /></>) },
];
// Pinned under the main list: the public setup guide (opens in a new tab) and Settings.
const DOCS = { href: "/docs", label: "Docs", icon: icon(<><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5z" /><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3" /></>) };
const SETTINGS: Item = { href: "/beta/settings", label: "Settings", match: (p) => p.startsWith("/beta/settings"), icon: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>) };

const linkClass = "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors";

function NavLink({ item, path }: { item: Item; path: string }) {
  const active = item.match(path);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        linkClass,
        active ? "bg-ps-nav-active text-ps-text shadow-ps-nav" : "text-ps-muted hover:bg-ps-fg/[0.03] hover:text-ps-text",
      )}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}

export function Sidebar(props: {
  viewer: { name: string; email: string; avatarUrl: string | null };
  plan: { name: string; used: number; limit: number; resets: string } | null;
  signOut: () => Promise<void>;
  theme?: Theme;
}) {
  const path = usePathname() ?? "/beta";
  const percent = props.plan && props.plan.limit > 0 ? Math.min(100, (props.plan.used / props.plan.limit) * 100) : 0;
  return (
    <nav aria-label="Main" className="flex w-full flex-col gap-5 border-b border-ps-line bg-ps-sidebar px-3 py-3.5 md:sticky md:top-0 md:h-screen md:w-60 md:flex-none md:border-b-0 md:border-r">
      {/* Who is signed in: their photo (or a symbol), name and email. */}
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <ActorMark kind="user" name={props.viewer.name} avatarUrl={props.viewer.avatarUrl} size={30} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-ps-text">{props.viewer.name}</span>
          <span className="truncate text-[11px] text-ps-subtle">{props.viewer.email}</span>
        </span>
        <ThemeToggle initial={props.theme ?? "dark"} />
      </div>

      <div className="flex flex-col gap-0.5">
        {ITEMS.map((item) => <NavLink key={item.href} item={item} path={path} />)}
      </div>

      <div className="hidden flex-1 md:block" />

      <div className="flex flex-col gap-0.5">
        <a href={DOCS.href} target="_blank" rel="noopener" className={cn(linkClass, "text-ps-muted hover:bg-ps-fg/[0.03] hover:text-ps-text")}>
          {DOCS.icon}
          <span className="flex-1">{DOCS.label}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="text-ps-subtle"><path d="M7 17 17 7M8 7h9v9" /></svg>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <NavLink item={SETTINGS} path={path} />
      </div>

      {props.plan && (
        <Link href="/beta/usage" className="block rounded-[10px] border border-ps-line bg-ps-surface p-3 hover:border-ps-line-strong">
          <div className="flex justify-between text-xs">
            <span className="text-ps-muted">Posts this month</span>
            <span className="font-mono text-ps-text">{props.plan.used.toLocaleString("en-US")} / {props.plan.limit.toLocaleString("en-US")}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded bg-ps-fg/[0.06]">
            <div className="h-full bg-ps-plum" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 text-[11px] text-ps-subtle">{props.plan.name} plan · resets {props.plan.resets}</div>
        </Link>
      )}

      <form action={props.signOut} onSubmit={forgetViewer}>
        <button type="submit" className={cn(linkClass, "w-full text-ps-muted hover:bg-ps-fg/[0.03] hover:text-ps-text")}>
          {icon(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>)}
          <span>Sign out</span>
        </button>
      </form>
    </nav>
  );
}
