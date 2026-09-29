"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, Plus, Calendar, Users, Activity, ChevronDown, Settings, Code2, Images, LogOut } from "lucide-react";
import { Brand } from "./brand";
import { cn } from "@/lib/utils";
import React from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { authClient } from "@/lib/auth-client";

const navItems = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/app/create", label: "Create", icon: Plus },
  { href: "/app/calendar", label: "Calendar", icon: Calendar },
  { href: "/app/accounts", label: "Accounts", icon: Users },
  { href: "/app/library", label: "Media", icon: Images },
  { href: "/app/activity", label: "Activity", icon: Activity },
  { href: "/app/settings", label: "Settings", icon: Settings },
  { href: "/app/developers", label: "Developers", icon: Code2 },
];

const mobileNavItems = navItems.filter((item) => !["/app/developers", "/app/library"].includes(item.href));

const approvalLabels = {
  confirm_each: "Confirm each publish",
  approve_after_draft: "Approve each draft",
  autonomous: "Fully autonomous",
};

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const workspace = useWorkspace();
  const { data: session, isPending } = authClient.useSession();
  const userLabel = session?.user?.name || session?.user?.email || "Signed in";

  async function handleSignOut() {
    const result = await authClient.signOut();
    if (result.error) return;
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="technical-grid flex min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-border bg-[#080610]/95 text-white md:flex">
        <div className="px-6 pb-6 pt-7">
          <Brand size="md" className="text-white" />
          <button className="grooved-surface mt-7 flex w-full items-center justify-between rounded-lg border border-border bg-surface/70 px-3 py-3 text-left text-xs text-ink-muted transition hover:border-border-strong hover:bg-surface">
            <span><strong className="block text-sm text-white">{workspace.name}</strong><span className="font-mono text-[10px] uppercase tracking-wider">{workspace.mode === "demo" ? "Sample workspace" : "Creator workspace"}</span></span>
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 px-4 py-2" aria-label="App navigation">
          <p className="utility-label mb-3 px-3 text-ink-subtle">Workspace</p>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg border px-3 py-3 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      active
                        ? "border-accent/40 bg-accent-muted text-white"
                        : "border-transparent text-white/55 hover:border-border hover:bg-surface/60 hover:text-white"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon className={cn("h-5 w-5", active && "text-accent")} aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="grooved-surface m-4 rounded-lg border border-border bg-surface/75 p-4">
          <p className="utility-label text-white/40">Approval mode</p>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-accent" />{approvalLabels[workspace.approvalPolicy]}</div>
        </div>
        <div className="border-t border-border p-4">
          <div className="grooved-surface rounded-lg border border-border bg-surface/75 p-4">
            <p className="utility-label text-white/40">Signed in as</p>
            <p className="mt-1 truncate text-sm font-semibold text-white" title={isPending ? undefined : String(userLabel)}>{isPending ? "Loading session…" : userLabel}</p>
            <button type="button" onClick={handleSignOut} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-white/5 px-3 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="relative flex items-center justify-center border-b border-border bg-[#090615] p-4 text-white md:hidden">
        <Brand size="sm" />
        {session && <button type="button" onClick={handleSignOut} className="absolute right-4 rounded-lg border border-border bg-white/5 p-2 text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Sign out"><LogOut className="h-5 w-5" aria-hidden="true" /></button>}
      </header>

      <nav className="fixed inset-x-3 bottom-3 z-50 rounded-[2rem] border border-border bg-surface/95 p-1.5 shadow-soft backdrop-blur md:hidden" aria-label="Mobile navigation">
          <ul className="grid grid-cols-6 gap-1">
            {mobileNavItems.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-1 rounded-[1.5rem] px-1 py-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      active
                        ? "bg-[#4A3D67] text-accent"
                        : "text-ink-muted hover:bg-surface-raised hover:text-ink"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
      </nav>

      <main className="min-w-0 flex-1 overflow-auto bg-canvas/80">
        <div className="mx-auto max-w-[1440px] px-4 pb-28 pt-8 md:px-9 md:py-10 xl:px-12">
          {children}
        </div>
      </main>
    </div>
  );
}
