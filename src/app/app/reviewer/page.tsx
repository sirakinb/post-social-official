"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRight, CheckCircle2, CircleAlert, CircleDashed, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace-provider";
import { api } from "../../../../convex/_generated/api";

const platformReviews = [
  {
    platform: "tiktok" as const,
    label: "TikTok Direct Post",
    permissions: "user.info.basic · video.publish",
    explanation: "Reads the connected creator identity and publishes only after the final approval step.",
  },
  {
    platform: "instagram" as const,
    label: "Instagram professional account",
    permissions: "instagram_business_basic · instagram_business_content_publish",
    explanation: "Reads the professional profile and publishes an image, carousel, or Reel selected by the user.",
  },
  {
    platform: "facebook" as const,
    label: "Facebook Page",
    permissions: "pages_show_list · pages_read_engagement · pages_manage_posts",
    explanation: "Lists only Pages with publishing access and publishes only to the Page selected in the composer.",
  },
  {
    platform: "threads" as const,
    label: "Threads account",
    permissions: "threads_basic · threads_content_publish",
    explanation: "Reads the connected Threads identity and publishes approved text with an optional single image.",
  },
] as const;

export default function ReviewerPage() {
  const workspace = useWorkspace();
  const accounts = useQuery(api.accounts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const posts = useQuery(api.posts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const awaitingApproval = posts?.filter((post) => post.status === "awaiting_approval").length ?? 0;
  const completed = posts?.filter((post) => ["published", "partially_published", "failed"].includes(post.status)).length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <header className="stage-enter rounded-xl border border-accent/25 bg-surface p-7 md:p-9">
        <div className="flex items-center gap-2 text-accent"><ShieldCheck className="h-5 w-5" /><p className="utility-label">Reviewer path</p></div>
        <h1 className="mt-4 text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em]">Test the real permission journey.</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-ink-muted">This path uses the same live account connections, composer, approval record, scheduler, and publishing workers as the product. Nothing below marks a platform post successful unless that platform confirms it.</p>
      </header>

      {workspace.mode === "demo" ? (
        <section className="grooved-surface rounded-xl border border-warning/30 bg-warning-bg p-6">
          <div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" /><div><h2 className="font-semibold text-ink">Reviewer sign-in required</h2><p className="mt-1 text-sm leading-6 text-ink-muted">The public preview contains sample information only. Use the reviewer credentials supplied with the submission to test real OAuth, approval, and publishing.</p><Button asChild className="mt-4" variant="primary"><Link href="/login">Sign in to reviewer workspace</Link></Button></div></div>
        </section>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {platformReviews.map((review) => {
              const account = accounts?.find((item) => item.platform === review.platform && item.health === "connected");
              return <article key={review.platform} className="grooved-surface rounded-xl border border-border bg-surface p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{review.label}</h2>{account ? <CheckCircle2 className="h-5 w-5 text-success" /> : <CircleDashed className="h-5 w-5 text-ink-subtle" />}</div><p className="utility-label mt-4 text-accent">{review.permissions}</p><p className="mt-3 text-sm leading-6 text-ink-muted">{review.explanation}</p><p className={`mt-4 text-xs font-semibold ${account ? "text-success" : "text-warning"}`}>{account ? `Connected as ${account.displayName}` : "Not connected yet"}</p></article>;
            })}
          </section>

          <section className="grooved-surface overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-b border-border p-6"><p className="utility-label text-accent">One complete review</p><h2 className="mt-2 text-2xl font-semibold">Connect → compose → approve → confirm</h2></div>
            <ol className="divide-y divide-border">
              <li className="grid gap-4 p-6 md:grid-cols-[42px_1fr_auto] md:items-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-muted font-mono text-sm text-accent">01</span><div><h3 className="font-semibold">Connect the platform account</h3><p className="mt-1 text-sm text-ink-muted">Complete the genuine platform consent screen and return with the account identity visible.</p></div><Button asChild variant="secondary"><Link href="/app/accounts">Open connections <ArrowRight className="h-4 w-4" /></Link></Button></li>
              <li className="grid gap-4 p-6 md:grid-cols-[42px_1fr_auto] md:items-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-muted font-mono text-sm text-accent">02</span><div><h3 className="font-semibold">Create the review post</h3><p className="mt-1 text-sm text-ink-muted">Add the supplied review content—text and media as the selected platform requires—choose the connected destination, and complete its required settings.</p></div><Button asChild variant="secondary"><Link href="/app/create">Open composer <ArrowRight className="h-4 w-4" /></Link></Button></li>
              <li className="grid gap-4 p-6 md:grid-cols-[42px_1fr_auto] md:items-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-muted font-mono text-sm text-accent">03</span><div><h3 className="font-semibold">Approve the final proof</h3><p className="mt-1 text-sm text-ink-muted">The permission is not used until a reviewer explicitly approves. {awaitingApproval} post{awaitingApproval === 1 ? " is" : "s are"} waiting now.</p></div><Button asChild variant="secondary"><Link href="/app/activity">Review approval <ArrowRight className="h-4 w-4" /></Link></Button></li>
              <li className="grid gap-4 p-6 md:grid-cols-[42px_1fr_auto] md:items-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-muted font-mono text-sm text-accent">04</span><div><h3 className="font-semibold">Open the confirmed result</h3><p className="mt-1 text-sm text-ink-muted">Activity shows processing, a sanitized failure, or the platform-confirmed live link. {completed} completed result{completed === 1 ? " is" : "s are"} available.</p></div><Button asChild variant="secondary"><Link href="/app/activity">View results <ArrowRight className="h-4 w-4" /></Link></Button></li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
