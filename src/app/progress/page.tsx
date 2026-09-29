import Link from "next/link";
import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  Code2,
  Facebook,
  Globe2,
  Instagram,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Music2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Brand } from "@/components/brand";

type StatusTone = "complete" | "review" | "waiting";

const currentStatus: Array<{
  name: string;
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  description: string;
}> = [
  {
    name: "TikTok",
    label: "Review submitted",
    tone: "review",
    icon: Music2,
    description:
      "Direct Post was tested with a real account, the final demonstration was recorded, and the application is with TikTok. Draft upload is intentionally saved for a later review.",
  },
  {
    name: "Instagram",
    label: "Waiting on Meta",
    tone: "review",
    icon: Instagram,
    description:
      "The dedicated Meta app is public, the required test call is complete, and both image and Reel demonstrations are included in the submitted review package.",
  },
  {
    name: "Facebook Pages",
    label: "Testing in progress",
    tone: "waiting",
    icon: Facebook,
    description:
      "Connection and real image publishing succeeded. We are waiting for Meta to register the final publishing test before submitting the three Page permissions.",
  },
  {
    name: "Meta business",
    label: "Access review active",
    tone: "review",
    icon: ShieldCheck,
    description:
      "Pentridge Media is business verified. Tech Provider Access Verification was submitted July 22, and Meta says it may follow up within five days.",
  },
];

const timeline = [
  {
    title: "Product direction defined",
    detail:
      "Combined the developer and agent-first strength of Zernio with the approachable language of Post Bridge: API and MCP first, with a friendly web experience.",
    icon: Sparkles,
  },
  {
    title: "Audience and launch scope set",
    detail:
      "Repositioned from agencies to creators, solopreneurs, and small businesses. The launch channels became TikTok Direct Post, Instagram, and Facebook Pages. Billing moved until after approvals.",
    icon: MessageSquareText,
  },
  {
    title: "Flexible approval rules designed",
    detail:
      "A person can require confirmation for every publish, approve a prepared draft once, or authorize an agent to publish autonomously. Each channel can inherit or override that choice.",
    icon: Workflow,
  },
  {
    title: "Brand and visual direction established",
    detail:
      "Thought Social remained the mobile content app; Post Social became the publishing web app. The interface moved to the original plum palette, dark grid, component grooves, smaller typography, and a dedicated mark.",
    icon: Layers3,
  },
  {
    title: "The working application was built",
    detail:
      "Home, Create, Calendar, Accounts, Media, Activity, Settings, and developer surfaces became a responsive creator workspace with real authentication and workspace data.",
    icon: Globe2,
  },
  {
    title: "One publishing foundation connected everything",
    detail:
      "The web app, REST API, and MCP tools now share drafts, approvals, schedules, media, validation, delivery records, revocable API keys, and audit history.",
    icon: Code2,
  },
  {
    title: "Security and account lifecycle completed",
    detail:
      "Credentials are encrypted, access can renew or revoke safely, Meta has a deletion callback, webhooks are signed, and people can delete unpublished posts or their workspace.",
    icon: LockKeyhole,
  },
  {
    title: "The public review foundation went live",
    detail:
      "postsocial.xyz was deployed with Privacy, Terms, data deletion, a reviewer path, OpenAPI details, the submission icon, and platform demo materials.",
    icon: Globe2,
  },
  {
    title: "TikTok was configured, tested, and submitted",
    detail:
      "OAuth and consent were completed, @sirakinb connected, a real Direct Post succeeded, the demonstration was re-recorded, the icon was added, and the review was submitted.",
    icon: Music2,
  },
  {
    title: "Facebook Pages connected and published",
    detail:
      "Meta credentials and Facebook Login for Business were repaired, the correct Page was shared, and a real image post published successfully through Post Social.",
    icon: Facebook,
  },
  {
    title: "Instagram image and Reel flows were proven",
    detail:
      "A professional account connected, a 170-second Reel processed and published, an image failure was diagnosed and retried, and the final review recording was completed.",
    icon: Instagram,
  },
  {
    title: "The Meta app structure was clarified",
    detail:
      "Two Meta apps remain to avoid restarting Instagram review: one for Instagram and one for Facebook Pages plus future Threads. Redundant Instagram permissions were removed from the Facebook review.",
    icon: Layers3,
  },
  {
    title: "Meta business verification was completed",
    detail:
      "Pentridge Media became Verified. Tech Provider Access Verification was submitted as an agency, consultancy, and SaaS platform using pentridgemedia.com and is now in review.",
    icon: ShieldCheck,
  },
];

const remaining = [
  "Wait for Meta's decision on the Instagram publishing review.",
  "Wait for Facebook's pages_manage_posts test counter, finish the reviewer answers, and submit the Facebook Pages review.",
  "Respond if Meta asks for more information during Tech Provider Access Verification.",
  "After launch approvals, add billing and then expand deliberately to LinkedIn, YouTube, X, and Threads.",
];

const toneClasses: Record<StatusTone, string> = {
  complete: "border-success/30 bg-success-bg text-success",
  review: "border-accent/35 bg-accent-muted/70 text-accent-hover",
  waiting: "border-warning/30 bg-warning-bg text-warning",
};

function StatusChip({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${toneClasses[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export const metadata = { robots: { index: false, follow: false } };

export default function ProgressPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="min-h-screen overflow-hidden bg-canvas text-ink">
      <header className="border-b border-border bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Brand size="sm" />
          <div className="utility-label text-ink-subtle">Updated · Jul 22, 2026</div>
        </div>
      </header>

      <section className="relative border-b border-border">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_20%,rgba(155,108,255,0.16),transparent_32%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:py-20 lg:grid-cols-[1fr_320px] lg:items-end">
          <div className="max-w-3xl">
            <p className="utility-label text-accent">Post Social / Build &amp; approval history</p>
            <h1 className="mt-5 max-w-2xl font-display text-[2.25rem] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[3rem]">
              From idea to a working publishing platform.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted sm:text-lg">
              Post Social now has a working web app, a shared API and MCP publishing layer, real TikTok, Instagram, and Facebook connections, completed demonstrations, and active platform approval work.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/app"
                className="grooved-accent inline-flex items-center gap-2 rounded-lg border border-accent-hover/50 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:brightness-110"
              >
                Open Post Social <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/app/reviewer"
                className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-accent/60 hover:bg-surface-raised"
              >
                Reviewer path <ArrowUpRight className="h-4 w-4" />
              </Link>
              <a
                href="https://www.postsocial.xyz"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted transition hover:text-ink"
              >
                Live website <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="grooved-surface rounded-2xl border border-border-strong bg-surface/80 p-5 shadow-soft">
            <p className="utility-label text-ink-subtle">Build at a glance</p>
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
              {[
                ["03", "Launch channels"],
                ["03", "Ways to publish"],
                ["01", "TikTok submitted"],
                ["02", "Meta reviews active"],
              ].map(([value, label]) => (
                <div key={label} className="bg-canvas-ivory p-4">
                  <dt className="font-mono text-2xl text-ink">{value}</dt>
                  <dd className="mt-1 text-xs leading-5 text-ink-subtle">{label}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="h-4 w-4" /> Web + API + MCP share one system
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-20 px-5 py-16 sm:px-8 md:py-20">
        <section aria-labelledby="now-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="utility-label text-accent">Right now</p>
              <h2 id="now-heading" className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
                Four approval tracks, clearly separated.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-ink-muted">
              A public app is not the same thing as an approved publishing permission. These cards show the actual state of each track.
            </p>
          </div>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            {currentStatus.map(({ name, label, tone, icon: Icon, description }) => (
              <article key={name} className="grooved-surface rounded-2xl border border-border bg-surface/75 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl border border-border-strong bg-canvas-ivory text-accent">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="font-display text-lg font-semibold">{name}</h3>
                  </div>
                  <StatusChip tone={tone}>{label}</StatusChip>
                </div>
                <p className="mt-5 text-sm leading-6 text-ink-muted">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="security-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="utility-label text-accent">Hardening</p>
              <h2 id="security-heading" className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
                What the security audit changed.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-ink-muted">
              This pass tightened private access, error handling, and account revocation while keeping public legal information available.
            </p>
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "Signed-out visitors are redirected from /app to /login; private workspace content is not rendered.",
              "/progress now returns 404 in production and is excluded from search indexing.",
              "The public data-deletion explanation remains available, but destructive workspace controls appear only for signed-in users; deletion attempts platform revocation first.",
              "Webhooks block private/internal network destinations; uploads validate type and size; public errors no longer expose stack traces or tokens.",
              "API keys have request limits; sessions/password/rate limits are stronger; browser security headers are active.",
              "Old low-level disconnect/delete calls are internal-only, so they cannot bypass the safe revocation workflow.",
            ].map((text) => (
              <div key={text} className="rounded-xl border border-border bg-surface/65 p-4">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  <p className="text-sm leading-6 text-ink-muted">{text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-canvas-ivory/70 p-4 text-xs text-ink-subtle">
            {[
              "77 tests passed",
              "TypeScript passed",
              "Lint passed",
              "Production build passed",
              "Live signed-out checks passed",
            ].map((label) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-success" /> {label}
              </span>
            ))}
          </div>
        </section>

        <section aria-labelledby="timeline-heading">
          <div className="max-w-2xl">
            <p className="utility-label text-accent">Beginning to today</p>
            <h2 id="timeline-heading" className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
              What we built, decided, tested, and submitted.
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              This is the full project story in plain English. Every completed item below moved Post Social closer to public publishing access.
            </p>
          </div>

          <ol className="relative mt-8 space-y-3 before:absolute before:bottom-7 before:left-[1.15rem] before:top-7 before:w-px before:bg-border-strong sm:before:left-[1.4rem]">
            {timeline.map(({ title, detail, icon: Icon }, index) => (
              <li key={title} className="relative grid grid-cols-[2.35rem_1fr] gap-3 sm:grid-cols-[2.8rem_1fr] sm:gap-4">
                <div className="relative z-10 grid h-9 w-9 place-items-center rounded-full border border-border-strong bg-canvas text-accent sm:h-11 sm:w-11">
                  <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="rounded-xl border border-border bg-surface/65 px-4 py-4 sm:px-5">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[11px] text-ink-subtle">{String(index + 1).padStart(2, "0")}</span>
                    <h3 className="font-medium text-ink">{title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink-muted sm:pl-8">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="architecture-heading">
          <div className="rounded-2xl border border-border-strong bg-surface/75 p-5 shadow-soft sm:p-7 lg:p-8">
            <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
              <div>
                <p className="utility-label text-accent">Architecture now</p>
                <h2 id="architecture-heading" className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em]">
                  One product family. Clear responsibilities.
                </h2>
                <p className="mt-3 text-sm leading-6 text-ink-muted">
                  The internal Meta split is workable and invisible to customers. It stays in place so we do not restart the Instagram review.
                </p>
              </div>

              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div className="rounded-xl border border-border bg-canvas-ivory p-4">
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-5 w-5 text-accent" />
                      <div><h3 className="font-medium">Thought Social</h3><p className="mt-1 text-xs text-ink-subtle">Mobile content creation</p></div>
                    </div>
                  </div>
                  <ArrowRight className="hidden h-4 w-4 text-ink-subtle sm:block" />
                  <div className="rounded-xl border border-accent/35 bg-accent-muted/40 p-4">
                    <div className="flex items-center gap-3">
                      <Bot className="h-5 w-5 text-accent-hover" />
                      <div><h3 className="font-medium">Post Social</h3><p className="mt-1 text-xs text-ink-subtle">Web + API + MCP publishing</p></div>
                    </div>
                  </div>
                </div>

                <ArrowDown className="mx-auto h-4 w-4 text-ink-subtle" />

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-canvas-ivory p-4">
                    <Music2 className="h-5 w-5 text-accent" /><h3 className="mt-3 text-sm font-medium">TikTok app</h3><p className="mt-1 text-xs leading-5 text-ink-subtle">Direct Post review</p>
                  </div>
                  <div className="rounded-xl border border-border bg-canvas-ivory p-4">
                    <Instagram className="h-5 w-5 text-accent" /><h3 className="mt-3 text-sm font-medium">Instagram Meta app</h3><p className="mt-1 text-xs leading-5 text-ink-subtle">Current Instagram review</p>
                  </div>
                  <div className="rounded-xl border border-border bg-canvas-ivory p-4">
                    <Facebook className="h-5 w-5 text-accent" /><h3 className="mt-3 text-sm font-medium">Facebook + Threads</h3><p className="mt-1 text-xs leading-5 text-ink-subtle">Pages now, Threads later</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]" aria-labelledby="remaining-heading">
          <div className="rounded-2xl border border-border bg-surface/70 p-5 sm:p-7">
            <p className="utility-label text-warning">What remains</p>
            <h2 id="remaining-heading" className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em]">
              The finish line is mostly external review.
            </h2>
            <ul className="mt-6 space-y-3">
              {remaining.map((item) => (
                <li key={item} className="flex gap-3 rounded-xl border border-border bg-canvas-ivory/70 p-4 text-sm leading-6 text-ink-muted">
                  <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <aside className="grooved-surface rounded-2xl border border-accent/30 bg-accent-muted/30 p-5 sm:p-7">
            <p className="utility-label text-accent-hover">Later / Threads</p>
            <h2 className="mt-2 font-display text-xl font-semibold">No third Meta app needed.</h2>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              Threads can be added to the existing Facebook and Threads Meta app when we are ready. It is the same approval pattern, but it still needs a real feature and demonstration.
            </p>
            <ol className="mt-6 space-y-3">
              {[
                "Build Connect Threads.",
                "Request threads_basic and threads_content_publish.",
                "Connect a test account and publish a test thread.",
                "Record the flow and submit those permissions.",
              ].map((item, index) => (
                <li key={item} className="flex items-center gap-3 text-sm text-ink-muted">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-accent/40 font-mono text-[10px] text-accent-hover">{index + 1}</span>
                  {item}
                </li>
              ))}
            </ol>
          </aside>
        </section>

        <section className="border-t border-border pt-10">
          <div className="grid gap-5 sm:grid-cols-3">
            {[
              ["People first", "Creators and small businesses are the customer—not agencies as the brand identity."],
              ["Approval before billing", "Flexible human and agent approval controls ship before subscriptions and pricing."],
              ["Approval is specific", "An app can be public while a publishing permission is still awaiting approval."],
            ].map(([title, text]) => (
              <div key={title} className="flex gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success-bg text-success"><Check className="h-3.5 w-3.5" /></span>
                <div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-5 text-ink-subtle">{text}</p></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="border-t border-border bg-canvas-ivory/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-7 text-xs text-ink-subtle sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>Post Social · Internal build and approval history</span>
          <span>No platform approval is claimed until the platform confirms it.</span>
        </div>
      </footer>
    </main>
  );
}
