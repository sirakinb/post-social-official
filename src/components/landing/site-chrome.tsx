import Link from "next/link";
import { Waitlist } from "@/components/landing/waitlist";
import { BETA_LOGIN, BETA_SIGNUP, signupOpen } from "@/lib/insforge/auth-rules";
import { cn } from "@/lib/utils";

// The landing's header, footer and main button, shared with the pricing page so both look the same.

const SECTIONS = [
  { label: "AI agents", id: "agents" },
  { label: "How it works", id: "how-it-works" },
  { label: "Features", id: "features" },
  { label: "Platforms", id: "platforms" },
];

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("lp-label", className)}>{children}</p>;
}

// The main button: "Start for free" once sign-up is open, the waitlist until then.
export function PrimaryCta({ variant = "lantern", label }: { variant?: "lantern" | "compact"; label?: string }) {
  if (!signupOpen()) return <Waitlist variant={variant} label={label} />;
  return (
    <Link href={BETA_SIGNUP} className={variant === "compact" ? "lp-lantern inline-flex rounded-full px-4 py-1.5 text-[12px]" : "lp-lantern inline-flex h-11 items-center rounded-full px-5 text-sm"}>
      Start for free
    </Link>
  );
}

// On the landing the section links are in-page anchors; elsewhere they lead back to the landing.
export function SiteHeader({ onLanding = false }: { onLanding?: boolean }) {
  const nav = [
    ...SECTIONS.map((s) => ({ label: s.label, href: `${onLanding ? "" : "/"}#${s.id}` })),
    { label: "Pricing", href: "/pricing" },
    { label: "FAQ", href: `${onLanding ? "" : "/"}#faq` },
    { label: "Docs", href: "/docs" },
  ];
  return (
    <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
      <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Post Social home">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static svg */}
        <img src="/post-social-icon.svg" alt="" className="size-7 rounded-[8px]" />
        <span className="lp-wordmark hidden text-[13px] sm:inline">Post Social</span>
      </Link>
      <nav aria-label="Landing page" className="lp-glass hidden items-center rounded-full px-1.5 py-1 lg:flex">
        {nav.map((item) => (
          <Link key={item.label} href={item.href} className="rounded-full px-3.5 py-1.5 text-[13px] text-[#FAF6F0]/70 transition hover:bg-white/[0.06] hover:text-[#FAF6F0]">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <Link href={BETA_LOGIN} className="rounded-full px-3 py-1.5 text-[13px] text-[#FAF6F0]/70 transition hover:text-[#FAF6F0]">
          Sign in
        </Link>
        <PrimaryCta variant="compact" />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
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
          <Link href="/affiliates" className="hover:text-[#FAF6F0]">Affiliates</Link>
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
  );
}
