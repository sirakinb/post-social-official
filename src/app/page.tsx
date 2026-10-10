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
// platform), then walks through what Post Social does, with real screens from the app.

type Platform = "tiktok" | "instagram" | "facebook" | "threads" | "youtube" | "linkedin" | "bluesky" | "x";



const PLATFORMS: { platform: Platform; name: string; text: string }[] = [
  { platform: "tiktok", name: "TikTok", text: "Videos and photo posts, or send a draft to your TikTok inbox to finish in the app." },
  { platform: "instagram", name: "Instagram", text: "Photos, Reels and carousels of up to 10 for professional accounts." },
  { platform: "facebook", name: "Facebook Pages", text: "Text, links, photos, Reels and videos on the Pages you manage." },
  { platform: "threads", name: "Threads", text: "Text, photos, videos and carousels of up to 20." },
  { platform: "youtube", name: "YouTube", text: "Shorts uploaded straight to your channel." },
  { platform: "linkedin", name: "LinkedIn", text: "Text, photos, galleries of up to 20 and videos on your profile." },
  { platform: "bluesky", name: "Bluesky", text: "Text, up to 4 photos or a video, with links, mentions and hashtags." },
  { platform: "x", name: "X", text: "Text, up to 4 photos or a video, posted to your account." },
];

const NAV = [
  { label: "Use with AI", href: "#agents" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Platforms", href: "#platforms" },
  { label: "FAQ", href: "#faq" },
];

const FAQ = [
  { q: "Which platforms are supported?", a: "TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky and X, each through the platform's official API and sign-in." },
  { q: "What can I publish?", a: "Videos and photo posts on TikTok; photos, Reels and carousels on Instagram; text, links, photos, Reels and videos on Facebook Pages; text, photos, videos and carousels on Threads; Shorts on YouTube; and text, photos and videos on LinkedIn, Bluesky and X. What a given account can post depends on its type and the platform's rules, and Post Social checks each file before it goes out." },
  { q: "Can an AI publish for me?", a: "Yes. Connect Claude, ChatGPT, or any AI agent, or call the API from your own automations. Your AI drafts, schedules and publishes exactly as you direct it. TikTok posts from an AI land in your TikTok inbox for you to finish." },
  { q: "Can I schedule posts?", a: "Yes. Publish now or pick a date and time, then see everything on the calendar and move it if plans change." },
  { q: "Do you need my social passwords?", a: "No. Each account connects through the platform's own sign-in page, and you can disconnect it at any time." },
  { q: "Is Post Social only for developers?", a: "No. If you can ask an AI for something in plain language, you can use Post Social. The web app does everything too, no code required." },
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

function Screen({ src, alt, priority, className }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={cn("lp-screen relative", className)}>
      <Image src={src} alt={alt} width={2400} height={1500} priority={priority} sizes="(max-width: 768px) 100vw, 60vw" className="block h-auto w-full rounded-[14px]" />
    </div>
  );
}

function Feature({ label, title, text, points, src, alt, flip }: { label: string; title: React.ReactNode; text: string; points: string[]; src: string; alt: string; flip?: boolean }) {
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
      <Screen src={src} alt={alt} className={cn(flip && "md:order-1")} />
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

          <Screen src="/landing/app-home.webp" alt="The Post Social home screen: what's going out next, what just went live, and what needs you" priority className="mt-16 w-full max-w-5xl sm:mt-20" />
        </div>
      </section>

      <main>
        {/* ===== Use with AI ===== */}
        <section id="agents" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24 sm:px-8 md:py-32">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <Label>Use with AI</Label>
              <h2 className="lp-h2 mt-3">
                Post from <span className="lp-display lp-ink">ChatGPT, Claude</span>, or any AI you already use.
              </h2>
              <p className="mt-5 max-w-xl leading-relaxed text-[#FAF6F0]/65 md:text-lg">
                Connect Post Social once, then just ask. Your AI writes the post, picks the channels, and publishes or schedules it directly, with no copying and no switching tabs.
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
            <div className="lp-card p-5 md:p-6" role="img" aria-label="Example chat: someone asks Claude to post a clip to TikTok, Instagram and Threads at 6 PM, and Claude confirms it is scheduled.">
              <div className="space-y-4 text-[15px]">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#9B6CFF]/25 px-4 py-3">Post today&apos;s behind-the-scenes clip to TikTok, Instagram and Threads at 6pm.</div>
                <div className="flex max-w-[92%] gap-3">
                  <AiMark app="claude" size={16} />
                  <div className="rounded-2xl rounded-tl-md border border-white/10 bg-black/25 px-4 py-3">
                    <p>Done. It&apos;s scheduled for 6:00 PM on all three.</p>
                    <div className="mt-3 flex items-center gap-1.5">
                      <PlatformCardIcon platform="tiktok" size="sm" />
                      <PlatformCardIcon platform="instagram" size="sm" />
                      <PlatformCardIcon platform="threads" size="sm" />
                      <span className="ml-1.5 text-xs text-[#FAF6F0]/50">Today, 6:00 PM</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== Product video (placeholder until the demo is recorded) ===== */}
        <section id="demo" className="mx-auto max-w-6xl scroll-mt-8 px-5 pb-24 sm:px-8 md:pb-32">
          <div role="img" aria-label="Product video coming soon" className="lp-screen relative mx-auto aspect-video max-w-5xl">
            <div className="flex h-full w-full items-center justify-center rounded-[14px] border border-white/[0.06] bg-[radial-gradient(70%_80%_at_50%_100%,rgba(255,170,100,0.12),transparent_70%),linear-gradient(180deg,#1b1530,#140f24)]">
              <span className="grid size-16 place-items-center rounded-full border border-white/15 bg-[#0B0816]/80 text-[#FAF6F0] shadow-[0_0_40px_rgba(255,170,100,0.18)] md:size-20">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="ml-1 size-6 md:size-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M7 4.5v15l12-7.5z" />
                </svg>
              </span>
            </div>
          </div>
        </section>

        {/* ===== The problem ===== */}
        <section className="lp-band">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-24">
            <Label>One post. Every channel.</Label>
            <h2 className="lp-h2 mt-3 max-w-3xl">Stop rebuilding the same post five times.</h2>
            <p className="mt-5 max-w-2xl leading-relaxed text-[#FAF6F0]/65 md:text-lg">
              No more downloading and re-uploading, switching tabs, or wondering whether a post went live. Post Social keeps your media, channels, timing and results together in one place.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { title: "Less tab switching", text: "Write once, choose your channels, done." },
                { title: "Ready for each platform", text: "Sizes, lengths and captions checked before anything goes out." },
                { title: "One clear history", text: "Every post, every channel, and what happened to it." },
              ].map((item) => (
                <div key={item.title} className="lp-card px-5 py-5">
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#FAF6F0]/60">{item.text}</p>
                </div>
              ))}
            </div>
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
              { title: "Connect your accounts", text: "Sign in to each platform once through its official page. Connect your AI app the same way." },
              { title: "Say what to post", text: "Ask your AI, or use the composer: add your video or photos, write the caption once, pick the channels." },
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

        {/* ===== Features, with real screens ===== */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-8 space-y-24 px-5 pb-24 sm:px-8 md:space-y-32 md:pb-32">
          <Feature
            label="Create"
            title="Write it once. It fits everywhere."
            text="Drop in a video or photos, write the caption, and pick your channels. The preview shows each platform's version, and Post Social checks lengths, sizes and formats before anything goes out."
            points={["Live preview for every channel", "Per-platform options, like TikTok privacy and disclosures", "Your media library, ready to reuse"]}
            src="/landing/app-create.webp"
            alt="The Post Social composer with a video, caption, chosen channels and a live preview"
          />
          <Feature
            flip
            label="Calendar"
            title="Schedule it, then get back to your work."
            text="See the week ahead at a glance, with every post shown as its picture and the channels it goes to. Batch your content, then move on."
            points={["Week, two-week and list views", "Posts from you and from your AI, side by side", "Reschedule in a couple of clicks"]}
            src="/landing/app-calendar.webp"
            alt="The Post Social calendar showing a week of scheduled posts"
          />
          <Feature
            label="Activity"
            title="Know what happened after you hit publish."
            text="Every channel reports back on its own: live, scheduled, or needs attention. When something needs you, it says what and why, in plain words."
            points={["A status for every channel", "Who posted it: you, Claude, ChatGPT or an automation", "A clear next step when something needs you"]}
            src="/landing/app-activity.webp"
            alt="The Post Social activity feed with a status for each post and channel"
          />
          <Feature
            flip
            label="Accounts & AI"
            title="Your channels and your AI, in one place."
            text="Connect each platform through its official sign-in, then connect Claude or ChatGPT in a click. See exactly which apps can post for you, and switch any of them off at any time."
            points={["Official sign-in for every platform", "Connected AI apps and API keys, with what each can do", "Disconnect anything, any time"]}
            src="/landing/app-accounts.webp"
            alt="Post Social connected accounts and connected AI apps"
          />
        </section>

        {/* ===== Platforms ===== */}
        <section id="platforms" className="lp-band scroll-mt-8">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-28">
            <Label>Platforms</Label>
            <h2 className="lp-h2 mt-3 max-w-3xl">Starting with the places your content already lives.</h2>
            <p className="mt-5 max-w-2xl leading-relaxed text-[#FAF6F0]/65 md:text-lg">Eight platforms, one workspace. Each connects through the platform&apos;s official sign-in.</p>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORMS.map((p) => (
                <div key={p.platform} className="lp-card p-6 transition-colors hover:border-white/20">
                  <PlatformCardIcon platform={p.platform} />
                  <h3 className="mt-4 text-lg font-medium">{p.name}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#FAF6F0]/60">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

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
            <p className="mx-auto mt-5 max-w-xl leading-relaxed text-[#FAF6F0]/70 md:text-lg">Publish everywhere from one workspace, or straight from your AI. We&apos;re letting people in a few at a time.</p>
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
        <p className="mx-auto max-w-6xl px-5 pb-8 text-xs text-[#FAF6F0]/35 sm:px-8">© 2026 Pentridge Media. All rights reserved.</p>
      </footer>
    </div>
  );
}
