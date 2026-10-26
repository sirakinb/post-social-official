import type { Metadata } from "next";
import { Label, SiteFooter, SiteHeader } from "@/components/landing/site-chrome";
import { Fraunces, GeistPixelGrid } from "../fonts";

export const metadata: Metadata = {
  title: "Affiliate program · Post Social",
  description: "Earn 20% of what the customers you refer pay Post Social, every month for 24 months.",
};

// Joining is by approval: people apply by email and Aki invites the ones that fit from Rewardful.
// Rewardful's plan has no approval step, so its open sign-up link is deliberately not shown here.
const APPLY_URL = "mailto:hello@postsocial.xyz?subject=Affiliate%20application";

const WHO_FOR = [
  { title: "Friends of Post Social", text: "You like Post Social and know people who would too. Share it with them." },
  { title: "Creators who use AI tools", text: "You already work with Claude, ChatGPT or your own agents. Show people how you post with them." },
  { title: "Agencies and operators", text: "You run social media for your own brands or for other people's. Recommend Post Social to the ones that fit." },
];

const STEPS = [
  { title: "Apply", text: "Email hello@postsocial.xyz with a little about you and where you'd share Post Social." },
  { title: "Share your link", text: "You get a personal link. Anyone who signs up through it is tracked to you." },
  { title: "Get paid", text: "Commissions and payouts are handled through Rewardful, where you can see what you've earned." },
];

const FAQ = [
  { q: "How do I join?", a: "Email hello@postsocial.xyz. We review each application and send an invite to the people we partner with." },
  { q: "How much do I earn?", a: "20% of what the customers you refer pay Post Social, on every paid invoice, for 24 months." },
  { q: "Which payments earn commission?", a: "Payments that have been made and not refunded. Refunded payments don't earn commission." },
  { q: "Can I refer myself?", a: "No. Referring your own account doesn't earn commission." },
  { q: "How are referrals tracked?", a: "When someone visits Post Social through your link, a cookie remembers it, and their payment is credited to you." },
  { q: "Who pays me?", a: "Payouts are handled through Rewardful, the service that runs the program." },
  { q: "Where are the full terms?", a: "In the affiliate program section of our terms of service." },
];

export default function AffiliatesPage() {
  return (
    <div className={`lp ${Fraunces.variable} ${GeistPixelGrid.variable} relative isolate min-h-screen overflow-x-clip bg-[#0B0816] text-[#FAF6F0]`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(155,108,255,0.18),transparent_70%)]" />
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-12 sm:px-8 md:pb-32 md:pt-20">
        <div className="text-center">
          <Label>Affiliate program</Label>
          <h1 className="lp-h2 mt-3">
            <span className="lp-display lp-ink">Earn 20%</span> for 24 months.
          </h1>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-[#FAF6F0]/65">
            Refer people to Post Social and earn 20% of what they pay, every month for 24 months.
          </p>
          <div className="mt-8">
            <a href={APPLY_URL} className="lp-lantern inline-flex h-11 items-center rounded-full px-5 text-sm">
              Apply to join
            </a>
          </div>
        </div>

        <section aria-labelledby="who-for" className="mt-20">
          <Label>Who it&apos;s for</Label>
          <h2 id="who-for" className="lp-h2 mt-3">People who&apos;d recommend Post Social.</h2>
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {WHO_FOR.map((item) => (
              <li key={item.title} className="lp-card p-5">
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#FAF6F0]/65">{item.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-it-works" className="mt-20">
          <Label>How it works</Label>
          <h2 id="how-it-works" className="lp-h2 mt-3">Three steps.</h2>
          <ol className="mt-8 space-y-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="lp-card flex gap-4 p-5">
                <span className="lp-label flex-none pt-1">0{index + 1}</span>
                <div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-[#FAF6F0]/65">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="sign-up" aria-labelledby="faq" className="mt-20 scroll-mt-8">
          <Label>FAQ</Label>
          <h2 id="faq" className="lp-h2 mt-3">Questions, answered.</h2>
          <div className="mt-8 space-y-3">
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
          <div className="mt-10 text-center">
            <a href={APPLY_URL} className="lp-lantern inline-flex h-11 items-center rounded-full px-5 text-sm">
              Apply to join
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
