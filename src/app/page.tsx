import Link from "next/link";
import Image from "next/image";
import { CalendarDays, Check, ChevronRight, Clock, Play } from "lucide-react";
import { Brand } from "@/components/brand";
import { PlatformCardIcon, PlatformStrip } from "@/components/platform-logos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function UtilityLabel({ children }: { children: React.ReactNode }) {
  return <span className="utility-label inline-block text-accent">{children}</span>;
}

function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "font-display text-3xl font-semibold tracking-[-0.04em] text-ink md:text-4xl",
        className,
      )}
    >
      {children}
    </h2>
  );
}

function Body({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg",
        className,
      )}
    >
      {children}
    </p>
  );
}

interface ScreenshotFrameProps {
  src: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
}

function ScreenshotFrame({
  src,
  alt,
  priority,
  sizes = "100vw",
  className,
}: ScreenshotFrameProps) {
  return (
    <div className={cn("relative w-full select-none", className)}>
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-accent/25 to-transparent opacity-50 blur-sm" />
      <div className="grooved-surface relative overflow-hidden rounded-2xl border border-border bg-surface/80 shadow-soft backdrop-blur-sm">
        <Image
          src={src}
          alt={alt}
          width={1440}
          height={900}
          priority={priority}
          sizes={sizes}
          className="block h-auto w-full"
        />
      </div>
    </div>
  );
}

function HeroVideoPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn("relative w-full select-none", className)}>
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-accent/25 to-transparent opacity-50 blur-sm" />
      <div
        className="grooved-surface relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface/80 shadow-soft backdrop-blur-sm"
        role="img"
        aria-label="Product video coming soon"
      >
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-border bg-canvas/60 text-ink md:h-20 md:w-20">
          <Play className="ml-1 h-6 w-6 md:h-8 md:w-8" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

const navItems = [
  { label: "Use with AI", href: "#agents" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Platforms", href: "#platforms" },
  { label: "FAQ", href: "#faq" },
];

export default function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <div className="technical-grid min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-8">
          <Brand />
          <nav
            className="hidden items-center gap-1 md:flex"
            aria-label="Landing page"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-md px-2 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline-block"
            >
              Log in
            </Link>
            <Button asChild variant="primary" size="sm">
              <Link href="/login">Start my first post</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 md:pb-24 md:pt-20">
          <div className="text-center">
            <PlatformStrip size="lg" />
            <h1 className="mx-auto mt-6 max-w-5xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.05em] text-ink md:text-6xl">
              Social media posting for{" "}
              <span className="block md:whitespace-nowrap">
                AI-native creators and operators.
              </span>
            </h1>
            <Body className="mx-auto mt-5 text-balance">
              Let Claude, ChatGPT, or your own automations draft and schedule to
              all your channels.
            </Body>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild variant="primary" size="lg">
                <Link href="/login">Start my first post</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="#how-it-works">See how it works</Link>
              </Button>
            </div>
          </div>
          <HeroVideoPlaceholder className="mx-auto mt-14 max-w-5xl" />
        </section>

        <section
          id="agents"
          className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-24"
        >
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <UtilityLabel>Use with AI</UtilityLabel>
              <SectionHeading className="mt-3">
                Post from ChatGPT, Claude, or any AI you already use.
              </SectionHeading>
              <Body className="mt-4">
                Connect Post Social once, then just ask. Your AI drafts the
                post, picks the channels, and publishes or schedules it
                directly, with no copying and no switching tabs.
              </Body>
              <ul className="mt-6 space-y-3 text-sm text-ink-muted md:text-base">
                {[
                  "Ask in plain language. No code required.",
                  "Works with Claude, ChatGPT, Codex, and your own automations.",
                  "Publish now or schedule for later, straight from the chat.",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check
                      className="mt-1 h-4 w-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Button asChild variant="primary" size="lg">
                  <Link href="/login">
                    Connect your AI
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
            <div
              className="grooved-surface rounded-2xl border border-border bg-surface/60 p-5 md:p-6"
              role="img"
              aria-label="Example chat: a person asks an AI assistant to post a video to TikTok, Instagram, and Threads at 6 PM, and the assistant confirms it is scheduled."
            >
              <div className="space-y-4">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent-muted px-4 py-3 text-sm text-ink">
                  Post today&apos;s behind-the-scenes clip to TikTok, Instagram,
                  and Threads at 6pm.
                </div>
                <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-border bg-canvas/60 px-4 py-3 text-sm text-ink">
                  <p>Done. Scheduled for 6:00 PM on all three channels.</p>
                  <div className="mt-3 flex items-center gap-2">
                    <PlatformCardIcon platform="tiktok" size="sm" />
                    <PlatformCardIcon platform="instagram" size="sm" />
                    <PlatformCardIcon platform="threads" size="sm" />
                    <span className="ml-1 text-xs text-ink-subtle">
                      Scheduled today, 6:00 PM
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
            <UtilityLabel>One post. Eight destinations.</UtilityLabel>
            <SectionHeading className="mt-3">
              Stop rebuilding the same post eight times.
            </SectionHeading>
            <Body className="mt-4">
              No more downloading and re-uploading, switching tabs, or wondering
              whether a post went live. Post Social keeps your media,
              destination choices, timing, and publishing result together in
              one place.
            </Body>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                "Less tab switching",
                "Platform-ready details",
                "One clear publishing history",
              ].map((title) => (
                <div
                  key={title}
                  className="rounded-xl border border-border bg-canvas/60 px-4 py-3.5"
                >
                  <span className="text-sm font-medium text-ink">{title}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-24"
        >
          <SectionHeading className="text-center">
            From idea to everywhere in three steps.
          </SectionHeading>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Bring your post",
                text: "Upload an image or video and write the main caption once. Everything starts here.",
              },
              {
                step: "02",
                title: "Make each version fit",
                text: "Choose destinations and adjust platform-specific details without starting over.",
              },
              {
                step: "03",
                title: "Publish now or pick the moment",
                text: "Confirm the post, schedule it, and see what happened for every destination.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="grooved-surface relative rounded-2xl border border-border bg-surface/60 p-6"
              >
                <span className="utility-label text-ink-subtle">
                  Step {item.step}
                </span>
                <h3 className="mt-3 font-display text-xl font-semibold text-ink">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Button asChild variant="primary" size="lg">
              <Link href="/login">Start posting</Link>
            </Button>
          </div>
        </section>

        <section
          id="features"
          className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-16 md:pb-24"
        >
          <div className="space-y-16 md:space-y-24">
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div>
                <UtilityLabel>Workspace</UtilityLabel>
                <h3 className="mt-3 font-display text-2xl font-semibold tracking-[-0.035em] text-ink md:text-3xl">
                  One workspace for the whole posting loop.
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-muted md:text-base">
                  Create a post, manage connected accounts, browse the calendar,
                  keep media handy, and review activity history—all without
                  leaving Post Social.
                </p>
                <ul className="mt-5 space-y-2 text-sm text-ink-muted">
                  {[
                    "Connected accounts and connection status",
                    "Calendar view of scheduled posts",
                    "Media library for reuse",
                    "Activity history with plain-language status",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-success"
                        aria-hidden="true"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <ScreenshotFrame
                src="/landing/post-social-create.png"
                alt="Post Social workspace with the create post form"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            </div>

            <div className="grid items-center gap-8 md:grid-cols-2">
              <div className="order-2 md:order-1">
                <ScreenshotFrame
                  src="/landing/post-social-calendar.png"
                  alt="Post Social calendar view of scheduled posts"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>
              <div className="order-1 md:order-2">
                <UtilityLabel>Scheduling</UtilityLabel>
                <h3 className="mt-3 font-display text-2xl font-semibold tracking-[-0.035em] text-ink md:text-3xl">
                  Schedule it, then get back to your work.
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-muted md:text-base">
                  Pick a date and time for each post. The calendar keeps your
                  plan visible so you can batch content and move on to the next
                  thing.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-canvas-ivory px-3 py-1.5 text-xs font-medium text-ink">
                    <CalendarDays
                      className="h-3.5 w-3.5 text-accent"
                      aria-hidden="true"
                    />
                    Calendar view
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-canvas-ivory px-3 py-1.5 text-xs font-medium text-ink">
                    <Clock
                      className="h-3.5 w-3.5 text-accent"
                      aria-hidden="true"
                    />
                    Publish later
                  </span>
                </div>
              </div>
            </div>

            <div className="grid items-center gap-8 md:grid-cols-2">
              <div>
                <UtilityLabel>Activity</UtilityLabel>
                <h3 className="mt-3 font-display text-2xl font-semibold tracking-[-0.035em] text-ink md:text-3xl">
                  Know what happened after you click publish.
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-muted md:text-base">
                  Each destination gets its own status: processing, published,
                  or needs attention. No guessing, no tab switching to check.
                </p>
                <ul className="mt-5 space-y-2 text-sm text-ink-muted">
                  {[
                    "Per-destination status",
                    "Plain-language activity feed",
                    "Clear next step when something needs you",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-success"
                        aria-hidden="true"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <ScreenshotFrame
                src="/landing/post-social-activity.png"
                alt="Post Social activity feed with publishing status"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            </div>
          </div>
        </section>

        <section
          id="platforms"
          className="scroll-mt-20 border-y border-border bg-surface/40"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
            <SectionHeading>
              Starting with the places your content already lives.
            </SectionHeading>
            <Body className="mt-4">
              Eight destinations, one workspace. Each connects through the
              platform&apos;s official sign-in.
            </Body>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  platform: "tiktok" as const,
                  name: "TikTok",
                  description:
                    "Direct video publishing with audience, interaction, and disclosure choices.",
                },
                {
                  platform: "instagram" as const,
                  name: "Instagram",
                  description:
                    "Photo posts and Reels for connected professional accounts.",
                },
                {
                  platform: "facebook" as const,
                  name: "Facebook Pages",
                  description: "Photo publishing for Pages you manage.",
                },
                {
                  platform: "threads" as const,
                  name: "Threads",
                  description: "Text posts and one image for connected accounts.",
                },
                {
                  platform: "youtube" as const,
                  name: "YouTube",
                  description: "Video uploads to your channel.",
                },
                {
                  platform: "linkedin" as const,
                  name: "LinkedIn",
                  description: "Posts for your professional profile.",
                },
                {
                  platform: "bluesky" as const,
                  name: "Bluesky",
                  description: "Text and image posts.",
                },
                {
                  platform: "x" as const,
                  name: "X",
                  description: "Text and media posts.",
                },
              ].map((platform) => (
                <div
                  key={platform.platform}
                  className="rounded-2xl border border-border bg-canvas/60 p-6 transition-colors hover:border-border-strong"
                >
                  <PlatformCardIcon platform={platform.platform} />
                  <h3 className="mt-4 font-display text-lg font-semibold text-ink">
                    {platform.name}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    {platform.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="faq"
          className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 md:py-24"
        >
          <SectionHeading className="text-center">FAQ</SectionHeading>
          <div className="mt-10 space-y-3">
            {[
              {
                question: "Which platforms are supported?",
                answer:
                  "TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky, and X. Each uses official platform APIs.",
              },
              {
                question: "What can I publish?",
                answer:
                  "TikTok videos, Instagram photos and Reels for connected professional accounts, Facebook Page photos, Threads text posts with one optional image, YouTube videos, and text or media posts for LinkedIn, Bluesky, and X. Eligibility depends on your account type and platform requirements.",
              },
              {
                question: "Can I schedule posts?",
                answer:
                  "Yes. Choose publish now or a future date and time, then track it in the calendar.",
              },
              {
                question: "Can an AI agent publish for me?",
                answer:
                  "Yes. Connect ChatGPT, Claude, or your own automations, and they can draft, schedule, and publish for you directly.",
              },
              {
                question: "Do you need my social passwords?",
                answer:
                  "No. We use official authorization pages from each platform.",
              },
              {
                question: "Is Post Social only for developers?",
                answer:
                  "No. If you can ask an AI for something in plain language, you can use Post Social. No code required.",
              },
            ].map((faq) => (
              <details
                key={faq.question}
                className="group rounded-xl border border-border bg-canvas/60 open:bg-surface/40"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-5 py-4 text-sm font-semibold text-ink transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {faq.question}
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  />
                </summary>
                <div className="px-5 pb-5 text-sm leading-relaxed text-ink-muted">
                  {faq.answer}
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-16 pt-4 text-center md:pb-24">
          <div className="grooved-surface rounded-3xl border border-border bg-surface/60 p-8 md:p-14">
            <UtilityLabel>Your content is ready to move</UtilityLabel>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-ink md:text-4xl">
              Spend less time posting. Keep showing up.
            </h2>
            <Body className="mx-auto mt-4">
              Publish across eight destinations from one workspace, or straight
              from your AI.
            </Body>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild variant="primary" size="lg">
                <Link href="/login">Start my first post</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/login">Log in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div>
              <Brand size="sm" />
              <p className="mt-2 max-w-xs text-sm text-ink-subtle">
                Social media posting for AI-native creators and operators.
              </p>
            </div>
            <nav
              className="flex flex-wrap items-center gap-6 text-sm text-ink-muted"
              aria-label="Legal"
            >
              <Link
                href="/terms"
                className="rounded-md px-1 py-1 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Terms
              </Link>
              <Link
                href="/privacy"
                className="rounded-md px-1 py-1 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Privacy
              </Link>
              <Link
                href="/data-deletion"
                className="rounded-md px-1 py-1 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Data deletion
              </Link>
            </nav>
          </div>
          <div className="mt-8 border-t border-border pt-6 text-xs text-ink-subtle">
            © {year} Pentridge Media. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
