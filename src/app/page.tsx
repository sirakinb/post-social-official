import Image from "next/image";
import Link from "next/link";
import { DuskSky } from "@/components/landing/dusk-sky";
import { ParticleWordmark } from "@/components/landing/particle-wordmark";
import { Waitlist } from "@/components/landing/waitlist";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { Fraunces, GeistPixelGrid } from "./fonts";

// The landing: one screen at dusk. Lanterns drift off the lake the way posts leave for
// every platform; the wordmark is made of the same light.
export default function LandingPage() {
  return (
    <div className={`lp ${Fraunces.variable} ${GeistPixelGrid.variable} relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-[#0B0816] text-[#FAF6F0]`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <Image src="/landing/hero-dusk-2560.webp" alt="" fill priority sizes="100vw" className="object-cover object-[50%_40%]" />
        <DuskSky className="lp-sky absolute inset-0 h-full w-full" />
        <div className="lp-veil absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_58%,rgba(255,170,100,0.14),transparent_60%),linear-gradient(to_top,rgba(8,5,16,0.8)_0%,rgba(8,5,16,0.12)_45%,rgba(8,5,16,0.35)_100%)]" />
        <div className="lp-grain" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Post Social home">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static svg */}
          <img src="/post-social-icon.svg" alt="" className="size-7 rounded-[8px]" />
          <span className="lp-wordmark text-[13px]">Post Social</span>
        </Link>
        <nav aria-label="Site" className="flex items-center gap-2">
          <Link href="/docs" className="lp-glass hidden rounded-full px-4 py-1.5 text-[12px] text-[#FAF6F0]/65 transition hover:text-[#FAF6F0] sm:inline-flex">
            Docs
          </Link>
          <Link href={BETA_LOGIN} className="lp-glass inline-flex rounded-full px-4 py-1.5 text-[12px] text-[#FAF6F0]/65 transition hover:text-[#FAF6F0]">
            Sign in
          </Link>
        </nav>
      </header>

      <main className="relative z-20 flex flex-1 flex-col px-5 sm:px-8">
        <div className="lp-wordmark-canvas absolute left-1/2 top-[9%] w-[min(760px,92vw)] -translate-x-1/2 sm:top-[11%]">
          <ParticleWordmark text="POST SOCIAL" fontSize={84} gap={3} label="Post Social" fit />
        </div>

        <div className="mt-auto max-w-4xl pb-20 sm:pb-28">
          <h1 className="lp-rise text-[2.1rem] leading-[1.1] tracking-[-0.035em] sm:text-5xl">
            Social media posting for <span className="lp-display lp-ink">AI-native</span>
            <br className="hidden sm:block" /> creators and <span className="lp-display lp-ink">operators</span>.
          </h1>
          <p className="lp-rise lp-rise-delay-1 mt-5 max-w-xl text-[15px] leading-relaxed text-[#FAF6F0]/70 sm:text-base">
            Tell Claude, ChatGPT, or your own agent what to post. Post Social publishes it to TikTok, Instagram, Facebook, Threads and YouTube.
          </p>
          {/* Centred over the horizon on tall screens, under the text on short ones. No
              transform here: the waitlist panel is position: fixed and must cover the page. */}
          <div className="mt-7 flex [@media(min-height:740px)]:absolute [@media(min-height:740px)]:inset-x-0 [@media(min-height:740px)]:top-[48%] [@media(min-height:740px)]:-mt-6 [@media(min-height:740px)]:justify-center">
            <Waitlist />
          </div>
        </div>
      </main>

      <footer className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-5 pb-6 text-[12px] text-[#FAF6F0]/45 sm:px-8">
        <span>© 2026 Pentridge Media</span>
        <nav aria-label="Legal" className="flex gap-4">
          <Link href="/docs" className="hover:text-[#FAF6F0]">Docs</Link>
          <Link href="/privacy" className="hover:text-[#FAF6F0]">Privacy</Link>
          <Link href="/terms" className="hover:text-[#FAF6F0]">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
