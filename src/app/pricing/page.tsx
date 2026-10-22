import type { Metadata } from "next";
import { PricingCalculator } from "@/components/landing/pricing-calculator";
import { Label, PrimaryCta, SiteFooter, SiteHeader } from "@/components/landing/site-chrome";
import { Fraunces, GeistPixelGrid } from "../fonts";

export const metadata: Metadata = {
  title: "Pricing · Post Social",
  description: "Start free. Your first 2 accounts are free, then you pay per connected account, with every feature included.",
};

export default function PricingPage() {
  return (
    <div className={`lp ${Fraunces.variable} ${GeistPixelGrid.variable} relative isolate min-h-screen overflow-x-clip bg-[#0B0816] text-[#FAF6F0]`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(155,108,255,0.18),transparent_70%)]" />
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-12 sm:px-8 md:pb-32 md:pt-20">
        <div className="text-center">
          <Label>Pricing</Label>
          <h1 className="lp-h2 mt-3">
            <span className="lp-display lp-ink">Start free.</span> Pay only for the accounts you use.
          </h1>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-[#FAF6F0]/65">Your first 2 accounts are free, no card needed. After that it&apos;s usage based: you pay per account you connect, and every feature is included.</p>
        </div>
        <div className="mt-12">
          <PricingCalculator initial={2} cta={<PrimaryCta />} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
