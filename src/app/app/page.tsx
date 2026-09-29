"use client";

import Link from "next/link";
import { ArrowUpRight, Plus, Check, AlertTriangle, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { demoAccounts, demoPosts, platformLabel } from "@/lib/demo";
import { AccountAvatar } from "@/components/account-avatar";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import type { ConnectedAccount } from "@/lib/types";

export default function AppHomePage() {
  const workspace = useWorkspace();
  const liveAccounts = useQuery(api.accounts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const livePosts = useQuery(api.posts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const accounts: ConnectedAccount[] = workspace.mode === "live" ? (liveAccounts ?? []).map(account => ({ id: account._id, platform: account.platform, handle: account.handle, displayName: account.displayName, avatarUrl: account.avatarUrl, health: account.health, healthReason: account.healthReason })) : demoAccounts;
  const posts = workspace.mode === "live" ? (livePosts ?? []).map(post => ({ id: post._id, caption: post.caption, status: post.status, results: post.destinations.map(destination => ({ accountId: destination.connectedAccountId, platform: destination.platform })) })) : demoPosts;
  const upcoming = posts.filter((post) => post.status === "scheduled");
  const published = posts.filter((post) => post.status === "published");
  const attention = accounts.filter((account) => account.health !== "connected");
  const stats = [
    { label: "Published", value: published.length, detail: "All destinations confirmed", icon: Check, tone: "text-success bg-success-bg" },
    { label: "Scheduled", value: upcoming.length, detail: "Across the next 7 days", icon: Clock3, tone: "text-info bg-info-bg" },
    { label: "Needs review", value: attention.length + 2, detail: "Approval or reconnection", icon: AlertTriangle, tone: "text-warning bg-warning-bg" },
  ];

  return (
    <div className="space-y-8 pb-12">
      <section className="stage-enter border-b border-border pb-8">
        <div className="flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="utility-label text-accent">Post Social / Overview</p>
            <h1 className="mt-4 max-w-3xl text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">Your content is<br /><span className="scanline-accent">ready to go.</span></h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink-muted">Create once, choose your channels, and keep every post moving from one clear workspace.</p>
          </div>
          <div className="flex flex-wrap gap-3"><Button asChild variant="primary" size="lg"><Link href="/app/create"><Plus className="h-5 w-5" />Create a post</Link></Button><Button asChild variant="secondary" size="lg"><Link href="/app/calendar">View calendar <ArrowUpRight className="h-4 w-4" /></Link></Button></div>
        </div>
      </section>

      <section className="grooved-surface stage-enter-delayed overflow-hidden rounded-xl border border-border bg-surface/90">
        <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
          {stats.map(({ label, value, detail, icon: Icon, tone }) => <div key={label} className="p-5 md:p-6"><div className="flex items-start justify-between gap-4"><div><p className="utility-label text-ink-subtle">{label}</p><p className="mt-3 text-4xl font-semibold tracking-[-0.05em]">{String(value).padStart(2, "0")}</p></div><span className={`rounded-md p-2 ${tone}`}><Icon className="h-4 w-4" /></span></div><p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-ink-muted">{detail}</p></div>)}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.55fr_.7fr]">
        <div className="grooved-surface overflow-hidden rounded-xl border border-border bg-surface/90">
          <div className="flex items-center justify-between border-b border-border px-5 py-5 md:px-6"><div><p className="utility-label text-ink-subtle">Up next</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Publishing queue</h2></div><Link href="/app/calendar" className="font-mono text-xs uppercase tracking-wider text-accent hover:text-white">Full calendar →</Link></div>
          <div className="divide-y divide-border">{upcoming.map((post, index) => <div key={post.id} className="grid gap-4 px-5 py-5 sm:grid-cols-[62px_1fr_auto] sm:items-center md:px-6"><div><p className="utility-label text-ink-subtle">{index ? "Wed" : "Tue"}</p><p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{22 + index}</p></div><div><p className="max-w-xl text-base font-semibold">{post.caption}</p><div className="mt-2 flex -space-x-1">{post.results.map(result => <AccountAvatar key={result.accountId} platform={result.platform} name={platformLabel(result.platform)} size="sm" />)}</div></div><span className="rounded-md border border-accent/25 bg-accent-muted px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">Ready</span></div>)}{upcoming.length === 0 && <div className="px-6 py-10 text-center"><p className="font-medium">Your queue is clear.</p><p className="mt-1 text-sm text-ink-muted">Create a post when you are ready.</p></div>}</div>
        </div>
        <aside className="grooved-surface rounded-xl border border-border bg-[#0A0713]/90 p-6"><p className="utility-label text-ink-subtle">Connected channels</p><h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em]">One place to publish.</h2><ul className="mt-7 divide-y divide-border">{accounts.map(account => <li key={account.id} className="flex items-center gap-3 py-4 first:pt-0"><AccountAvatar platform={account.platform} name={account.displayName} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{account.displayName}</p><p className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">{platformLabel(account.platform)}</p></div><span className={`h-2 w-2 rounded-full ${account.health === "connected" ? "bg-success" : "bg-warning"}`} /></li>)}</ul>{accounts.length === 0 && <p className="mt-6 text-sm leading-6 text-ink-muted">Connect TikTok, Instagram, Facebook Pages, or Threads to start publishing.</p>}<Button asChild variant="secondary" className="mt-5 w-full"><Link href="/app/accounts">Manage accounts</Link></Button></aside>
      </section>
    </div>
  );
}
