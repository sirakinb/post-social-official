"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { forgetViewer } from "@/components/analytics/identify";
import { ActorMark } from "./marks";

type Item = { href: string; label: string; icon: React.ReactNode; match: (path: string) => boolean };

const icon = (d: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const MAIN: Item[] = [
  { href: "/beta", label: "Home", match: (p) => p === "/beta", icon: icon(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>) },
  { href: "/beta/create", label: "Create", match: (p) => p.startsWith("/beta/create"), icon: icon(<><path d="M12 5v14" /><path d="M5 12h14" /></>) },
  { href: "/beta/calendar", label: "Calendar", match: (p) => p.startsWith("/beta/calendar"), icon: icon(<><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>) },
  { href: "/beta/media", label: "Media", match: (p) => p.startsWith("/beta/media"), icon: icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.6" /><path d="m21 15-5-5L5 21" /></>) },
  { href: "/beta/activity", label: "Activity", match: (p) => p.startsWith("/beta/activity"), icon: icon(<path d="M3 12h4l3-8 4 16 3-8h4" />) },
];
const STATS: Item = { href: "/beta/stats", label: "Stats", match: (p) => p.startsWith("/beta/stats"), icon: icon(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />) };
const CONNECT: Item[] = [
  { href: "/beta/accounts", label: "Accounts & AI", match: (p) => p.startsWith("/beta/accounts") || p.startsWith("/beta/keys"), icon: icon(<><path d="M9 7H7a5 5 0 0 0 0 10h2" /><path d="M15 7h2a5 5 0 0 1 0 10h-2" /><path d="M8 12h8" /></>) },
  { href: "/beta/usage", label: "Usage", match: (p) => p.startsWith("/beta/usage"), icon: icon(<><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 12h-9V3" /></>) },
];

function NavLink({ item, path }: { item: Item; path: string }) {
  const active = item.match(path);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
        active ? "bg-ps-plum/[0.14] text-ps-text shadow-[inset_2px_0_0_#9B6CFF]" : "text-ps-muted hover:bg-white/[0.03] hover:text-ps-text",
      )}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}

export function Sidebar(props: {
  workspaceName: string;
  viewer: { name: string; avatarUrl: string | null; role: string };
  plan: { name: string; used: number; limit: number; resets: string } | null;
  statsEnabled: boolean;
  signOut: () => Promise<void>;
}) {
  const path = usePathname() ?? "/beta";
  const main = props.statsEnabled ? [...MAIN, STATS] : MAIN;
  const percent = props.plan && props.plan.limit > 0 ? Math.min(100, (props.plan.used / props.plan.limit) * 100) : 0;
  return (
    <nav aria-label="Main" className="flex w-full flex-col gap-5 border-b border-ps-line bg-ps-sidebar px-3 py-3.5 md:sticky md:top-0 md:h-screen md:w-60 md:flex-none md:border-b-0 md:border-r">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-ps-plum text-xs font-semibold text-ps-ground">{props.workspaceName.slice(0, 1).toUpperCase()}</span>
        <span className="flex-1 truncate text-[13px] font-medium text-ps-text">{props.workspaceName}</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {main.map((item) => <NavLink key={item.href} item={item} path={path} />)}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 pb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ps-subtle">Connect</div>
        {CONNECT.map((item) => <NavLink key={item.href} item={item} path={path} />)}
      </div>

      <div className="hidden flex-1 md:block" />

      {props.plan && (
        <Link href="/beta/usage" className="block rounded-[10px] border border-ps-line bg-ps-surface p-3 hover:border-ps-line-strong">
          <div className="flex justify-between text-xs">
            <span className="text-ps-muted">Posts this month</span>
            <span className="font-mono text-ps-text">{props.plan.used.toLocaleString("en-US")} / {props.plan.limit.toLocaleString("en-US")}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded bg-white/[0.06]">
            <div className="h-full bg-ps-plum" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 text-[11px] text-ps-subtle">{props.plan.name} plan · resets {props.plan.resets}</div>
        </Link>
      )}

      <div className="flex items-center gap-2.5 rounded-lg p-2">
        <ActorMark kind="user" name={props.viewer.name} avatarUrl={props.viewer.avatarUrl} size={26} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] text-ps-text">{props.viewer.name}</span>
          <span className="text-[11px] capitalize text-ps-subtle">{props.viewer.role}</span>
        </span>
        <form action={props.signOut} onSubmit={forgetViewer}>
          <button type="submit" className="rounded-md px-2 py-1 text-[11px] text-ps-subtle hover:bg-white/[0.04] hover:text-ps-text">Sign out</button>
        </form>
      </div>
    </nav>
  );
}
