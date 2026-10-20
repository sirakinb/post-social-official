import Image from "next/image";
import Link from "next/link";
import { CLAUDE_PATH, OPENAI_PATH } from "@/components/beta/marks";
import { DuskSky } from "@/components/landing/dusk-sky";
import { ParticleWordmark } from "@/components/landing/particle-wordmark";
import { Waitlist } from "@/components/landing/waitlist";
import { PlatformCardIcon } from "@/components/platform-logos";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { cn } from "@/lib/utils";
import { Fraunces, GeistPixelGrid } from "./fonts";

// The landing. It opens at dusk (lanterns leaving the lake the way posts leave for every
// platform) with the product video, then keeps to a few short sections: posting from your AI agent,
// three steps, the dashboard, platforms and questions. Light on app screens on purpose.

type Platform = "tiktok" | "instagram" | "facebook" | "threads" | "youtube" | "linkedin" | "bluesky" | "x";

const PLATFORMS: { platform: Platform; name: string }[] = [
  { platform: "tiktok", name: "TikTok" },
  { platform: "instagram", name: "Instagram" },
  { platform: "facebook", name: "Facebook Pages" },
  { platform: "threads", name: "Threads" },
  { platform: "youtube", name: "YouTube" },
  { platform: "linkedin", name: "LinkedIn" },
  { platform: "bluesky", name: "Bluesky" },
  { platform: "x", name: "X" },
];

// What people say about Post Social. The section stays hidden until there is at least one real quote.
const TESTIMONIALS: { quote: string; name: string; role: string }[] = [];

const NAV = [
  { label: "AI agents", href: "#agents" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Platforms", href: "#platforms" },
  { label: "FAQ", href: "#faq" },
];

const FAQ = [
  { q: "Which platforms are supported?", a: "TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky and X, each through the platform's official API and sign-in." },
  { q: "What can I publish?", a: "Videos and photo posts on TikTok; photos, Reels and carousels on Instagram; text, links, photos, Reels and videos on Facebook Pages; text, photos, videos and carousels on Threads; Shorts on YouTube; and text, photos and videos on LinkedIn, Bluesky and X. What a given account can post depends on its type and the platform's rules, and Post Social checks each file before it goes out." },
  { q: "Can my AI agent publish for me?", a: "Yes. Connect Claude, ChatGPT, or any AI agent, or call the API from your own automations. Your agent drafts, schedules and publishes exactly as you direct it." },
  { q: "Can I schedule posts?", a: "Yes. Publish now or pick a date and time, then see everything on the calendar and move it if plans change." },
  { q: "Do you need my social passwords?", a: "No. Each account connects through the platform's own sign-in page, and you can disconnect it at any time." },
  { q: "Is Post Social only for developers?", a: "No. If you can ask an AI agent for something in plain language, you can use Post Social. The web app does everything too, no code required." },
];

function AiMark({ app, size = 18 }: { app: "claude" | "openai"; size?: number }) {
  return (
    <span className={cn("inline-flex flex-none items-center justify-center rounded-md border border-white/10", app === "claude" ? "bg-[#1A1430]" : "bg-[#0D0D0D]")} style={{ width: size + 8, height: size + 8 }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path fill={app === "claude" ? "#D97757" : "#FFFFFF"} d={app === "claude" ? CLAUDE_PATH : OPENAI_PATH} />
      </svg>
    </span>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("lp-label", className)}>{children}</p>;
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-1 size-4 flex-none text-[#FFC48A]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

// A small chip on a screen's top-left corner naming where the screenshot comes from.
function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="lp-glass absolute bottom-full left-3 z-10 mb-3 inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] font-medium text-[#FAF6F0] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
      {icon}
      {label}
    </span>
  );
}

function Screen({ src, alt, width = 2400, height = 1500, priority, badge, className }: { src: string; alt: string; width?: number; height?: number; priority?: boolean; badge?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("lp-screen relative", badge && "mt-8 md:mt-0", className)}>
      {badge}
      <Image src={src} alt={alt} width={width} height={height} priority={priority} sizes="(max-width: 768px) 100vw, 60vw" className="block h-auto w-full rounded-[14px]" />
    </div>
  );
}

function Feature({ label, title, text, points, src, alt, width, height, badge, flip }: { label: string; title: React.ReactNode; text: string; points: string[]; src: string; alt: string; width?: number; height?: number; badge?: React.ReactNode; flip?: boolean }) {
  return (
    <div className={cn("grid items-center gap-10 md:gap-14", flip ? "md:grid-cols-[3fr_2fr]" : "md:grid-cols-[2fr_3fr]")}>
      <div className={cn(flip && "md:order-2")}>
        <Label>{label}</Label>
        <h3 className="mt-3 text-2xl font-medium tracking-[-0.03em] md:text-[2rem] md:leading-[1.15]">{title}</h3>
        <p className="mt-4 leading-relaxed text-[#FAF6F0]/65">{text}</p>
        <ul className="mt-5 space-y-2.5 text-[15px] text-[#FAF6F0]/75">
          {points.map((point) => (
            <li key={point} className="flex gap-2.5">
              <Check />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <Screen src={src} alt={alt} width={width} height={height} badge={badge} className={cn(flip && "md:order-1")} />
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className={`lp ${Fraunces.variable} ${GeistPixelGrid.variable} relative isolate overflow-x-clip bg-[#0B0816] text-[#FAF6F0]`}>
      {/* ===== Hero at dusk ===== */}
      <section className="relative isolate">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[100svh] min-h-[640px] overflow-hidden">
          <Image src="/landing/hero-dusk-2560.webp" alt="" fill priority sizes="100vw" className="object-cover object-[50%_42%]" />
          <DuskSky className="lp-sky absolute inset-0 h-full w-full" />
          <div className="lp-veil absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_45%,rgba(11,8,22,0.45),transparent_70%),linear-gradient(to_bottom,rgba(11,8,22,0.35)_0%,rgba(11,8,22,0.05)_35%,rgba(11,8,22,0.55)_75%,#0B0816_100%)]" />
          <div className="lp-grain" />
        </div>

        <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Post Social home">
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static svg */}
            <img src="/post-social-icon.svg" alt="" className="size-7 rounded-[8px]" />
            <span className="lp-wordmark hidden text-[13px] sm:inline">Post Social</span>
          </Link>
          <nav aria-label="Landing page" className="lp-glass hidden items-center rounded-full px-1.5 py-1 lg:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="rounded-full px-3.5 py-1.5 text-[13px] text-[#FAF6F0]/70 transition hover:bg-white/[0.06] hover:text-[#FAF6F0]">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href={BETA_LOGIN} className="rounded-full px-3 py-1.5 text-[13px] text-[#FAF6F0]/70 transition hover:text-[#FAF6F0]">
              Sign in
            </Link>
            <Waitlist variant="compact" />
          </div>
        </header>

        <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-5 pt-[6vh] text-center sm:px-8">
          <div className="lp-wordmark-canvas w-[min(640px,92vw)]">
            <ParticleWordmark text="POST SOCIAL" fontSize={64} gap={3} label="Post Social" fit />
          </div>

          <ul aria-label="Publishes to TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky and X" className="lp-rise mt-2 flex flex-wrap justify-center gap-2.5 sm:gap-3">
            {PLATFORMS.map((p) => (
              <li key={p.platform}>
                <PlatformCardIcon platform={p.platform} className="shadow-[0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/15" />
                <span className="sr-only">{p.name}</span>
              </li>
            ))}
          </ul>

          <h1 className="lp-rise mt-7 max-w-4xl text-[2.35rem] leading-[1.06] tracking-[-0.04em] sm:text-6xl">
            Social media management for <span className="lp-display lp-ink whitespace-nowrap">AI-native</span> creators and <span className="lp-display lp-ink">operators</span>.
          </h1>
          <p className="lp-rise lp-rise-delay-1 mt-5 max-w-2xl text-base leading-relaxed text-[#FAF6F0]/75 sm:text-lg">
            Tell Claude, ChatGPT, or your own agent what to post. Post Social publishes it to every channel, on time, and shows you what happened.
          </p>
          <div className="lp-rise lp-rise-delay-1 mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Waitlist />
            <a href="#how-it-works" className="lp-glass inline-flex h-11 items-center rounded-full px-5 text-sm text-[#FAF6F0] transition hover:bg-white/10">
              See how it works
            </a>
          </div>
          <p className="mt-6 inline-flex items-center gap-2 text-[13px] text-[#FAF6F0]/55">
            <AiMark app="claude" size={14} />
            <AiMark app="openai" size={14} />
            Works with Claude, ChatGPT or any AI agent
          </p>

          <div id="demo" className="lp-screen relative mt-16 w-full max-w-5xl scroll-mt-8 sm:mt-20">
            <video
              controls
              playsInline
              preload="none"
              poster="/landing/product-video-poster.webp"
              aria-label="Aki, the founder, shows Post Social: connect your accounts, connect your AI agent, then ask Claude to schedule a post"
              className="block aspect-video w-full rounded-[14px] border border-white/[0.06] bg-[#140f24]"
            >
              <source src="/landing/product-video.mp4" type="video/mp4" />
              <track kind="captions" src="/landing/product-video.vtt" srcLang="en" label="English" default />
            </video>
          </div>
        </div>
      </section>

      <main>
        {/* ===== Use with your AI agent ===== */}
        <section id="agents" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24 sm:px-8 md:py-32">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <Label>Use with your AI agent</Label>
              <h2 className="lp-h2 mt-3">
                Post from <span className="lp-display lp-ink">ChatGPT, Claude</span>, or any AI agent you already use.
              </h2>
              <p className="mt-5 max-w-xl leading-relaxed text-[#FAF6F0]/65 md:text-lg">
                Connect Post Social once, then just ask. Your agent writes the post, picks the channels, and publishes or schedules it directly, with no copying and no switching tabs.
              </p>
              <ul className="mt-6 space-y-2.5 text-[15px] text-[#FAF6F0]/75">
                {["Ask in plain language. No code required.", "Works with Claude, ChatGPT, Codex, and your own automations.", "Publish now or schedule for later, straight from the chat."].map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <Check />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <Screen
              src="/landing/claude-chat.webp"
              width={1525}
              height={1372}
              badge={<Badge icon={<AiMark app="claude" size={14} />} label="Claude" />}
              alt="A real Claude chat: asked to post a clip to Adzo's TikTok at 6pm, Claude uploads it, asks who should see it, drafts a caption and checks the post with Post Social"
            />
          </div>
        </section>

        {/* ===== How it works ===== */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24 sm:px-8 md:py-32">
          <div className="text-center">
            <Label>How it works</Label>
            <h2 className="lp-h2 mx-auto mt-3 max-w-3xl">
              From idea to <span className="lp-display lp-ink">everywhere</span> in three steps.
            </h2>
          </div>
          <ol className="mt-14 grid gap-5 md:grid-cols-3">
            {[
              { title: "Connect your accounts", text: "Sign in to each platform once through its official page. Connect your AI agent the same way." },
              { title: "Say what to post", text: "Ask your agent, or use the composer: add your video or photos, write the caption once, pick the channels." },
              { title: "It goes out, you see it land", text: "Publish now or pick the moment. Each channel reports back, and anything that needs you is flagged in plain words." },
            ].map((step, i) => (
              <li key={step.title} className="lp-card relative overflow-hidden p-6 md:p-7">
                <span className="lp-display text-5xl text-[#FFC48A]/80">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-5 text-xl font-medium tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#FAF6F0]/60">{step.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex justify-center">
            <Waitlist label="Get early access" />
          </div>
        </section>

        {/* ===== Features ===== */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-8 space-y-24 px-5 pb-24 sm:px-8 md:space-y-32 md:pb-32">
          <Feature
            label="You stay in charge"
            title="You decide what your agent can do."
            text="Post Social shows up in Claude as a connector. Choose which actions it can take on its own and which ones wait for your OK, and disconnect it whenever you like."
            points={["Let it read your posts and stats freely", "Make publishing ask you first", "Disconnect in one click"]}
            src="/landing/claude-connector.webp"
            width={2000}
            height={1150}
            alt="Post Social's tool permissions inside Claude, where each tool can be always allowed, need approval, or be blocked"
          />
          <Feature
            flip
            label="Prefer clicking?"
            title="The dashboard does it all, too."
            text="See what's going out next, what needs you, and who posted what, whether it was you, Claude or ChatGPT. Write and schedule posts right there when you'd rather do it yourself."
            points={["Everything going out next, on every channel", "Problems flagged in plain words, with the fix", "Posts from you and your agents, side by side"]}
            src="/landing/app-home.webp"
            alt="The Post Social home screen: posts going out next, one that needs attention, and recent activity from the team, Claude and ChatGPT"
            badge={
              <Badge
                icon={
                  // eslint-disable-next-line @next/next/no-img-element -- tiny static svg
                  <img src="/post-social-icon.svg" alt="" className="size-[22px] rounded-[6px]" />
                }
                label="Post Social"
              />
            }
          />
        </section>

        {/* ===== Platforms ===== */}
        <section id="platforms" className="lp-band scroll-mt-8">
          <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:px-8 md:py-24">
            <Label>Platforms</Label>
            <h2 className="lp-h2 mx-auto mt-3 max-w-3xl">Eight platforms, one place.</h2>
            <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-[#FAF6F0]/65 md:text-lg">Each connects through the platform&apos;s official sign-in. We never see your passwords.</p>
            <ul aria-label="Supported platforms" className="mt-10 flex flex-wrap justify-center gap-3">
              {PLATFORMS.map((p) => (
                <li key={p.platform} className="lp-card flex items-center gap-2.5 py-2 pl-2 pr-4 text-[15px]">
                  <PlatformCardIcon platform={p.platform} size="sm" />
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {TESTIMONIALS.length > 0 && (
          <section id="people" className="mx-auto max-w-6xl scroll-mt-8 px-5 pt-24 sm:px-8 md:pt-32">
            <h2 className="lp-h2 text-center">What people say</h2>
            <div className="mt-12 columns-1 gap-4 sm:columns-2 lg:columns-3">
              {TESTIMONIALS.map((t) => (
                <figure key={t.name} className="lp-card mb-4 break-inside-avoid p-6">
                  <blockquote className="leading-relaxed text-[#FAF6F0]/80">&ldquo;{t.quote}&rdquo;</blockquote>
                  <figcaption className="mt-4 text-sm text-[#FAF6F0]/55">
                    <span className="font-medium text-[#FAF6F0]">{t.name}</span>, {t.role}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* ===== FAQ ===== */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-8 px-5 py-24 sm:px-8 md:py-32">
          <div className="text-center">
            <Label>FAQ</Label>
            <h2 className="lp-h2 mt-3">Questions, answered.</h2>
          </div>
          <div className="mt-12 space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="lp-card group open:bg-white/[0.06]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none text-[#FAF6F0]/50 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="m6 3.5 4.5 4.5L6 12.5" />
                  </svg>
                </summary>
                <p className="px-5 pb-5 text-[15px] leading-relaxed text-[#FAF6F0]/65">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ===== Closing call, back at the lake ===== */}
        <section className="px-5 pb-24 sm:px-8 md:pb-32">
          <div className="relative isolate mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-white/10 px-6 py-16 text-center md:px-14 md:py-24">
            <Image src="/landing/hero-dusk-2560.webp" alt="" fill sizes="(max-width: 1024px) 100vw, 1024px" className="-z-10 object-cover object-[30%_70%]" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgba(11,8,22,0.55),rgba(11,8,22,0.75))]" />
            <Label>Your content is ready to move</Label>
            <h2 className="lp-h2 mx-auto mt-4 max-w-2xl">
              Spend less time posting. <span className="lp-display lp-ink">Keep showing up.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl leading-relaxed text-[#FAF6F0]/70 md:text-lg">Publish everywhere from one workspace, or straight from your AI agent. We&apos;re letting people in a few at a time.</p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Waitlist />
              <Link href={BETA_LOGIN} className="lp-glass inline-flex h-11 items-center rounded-full px-5 text-sm text-[#FAF6F0] transition hover:bg-white/10">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.07]">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny static svg */}
              <img src="/post-social-icon.svg" alt="" className="size-6 rounded-[7px]" />
              <span className="lp-wordmark text-[12px]">Post Social</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-[#FAF6F0]/45">Social media management for AI-native creators and operators.</p>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap gap-6 text-sm text-[#FAF6F0]/55">
            <Link href="/docs" className="hover:text-[#FAF6F0]">Docs</Link>
            <Link href="/privacy" className="hover:text-[#FAF6F0]">Privacy</Link>
            <Link href="/terms" className="hover:text-[#FAF6F0]">Terms</Link>
            <Link href="/data-deletion" className="hover:text-[#FAF6F0]">Data deletion</Link>
          </nav>
        </div>
        <p className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-5 pb-8 text-xs text-[#FAF6F0]/35 sm:px-8">
          <span>© 2026 Pentridge Media. All rights reserved.</span>
          <Link href="/changelog" className="hover:text-[#FAF6F0]/70">Changelog</Link>
        </p>
      </footer>
    </div>
  );
}
