"use client";

import { useState, type ReactNode } from "react";
import { FREE_ACCOUNTS, X_PRICES, monthlyBill } from "@/lib/pricing";
import { cn } from "@/lib/utils";

// The landing page's pricing: a big account count, one slider split into the price bands
// (free, $5, $2.50, $1), chips that spell out the bill, and the plan card with the total.

const MAX_ACCOUNTS = 2000;

// The slider runs 0–1000; each band gets its own stretch of track, so the small bands
// (where most people are) are easy to hit.
const SEGMENTS = [
  { from: 1, to: 2, start: 0, end: 160, label: "1–2", price: "Free" },
  { from: 3, to: 10, start: 160, end: 420, label: "3–10", price: "$5/mo" },
  { from: 11, to: 100, start: 420, end: 720, label: "11–100", price: "$2.50/mo" },
  { from: 101, to: MAX_ACCOUNTS, start: 720, end: 1000, label: "101+", price: "$1/mo" },
] as const;
const GAP = 1.2; // % of track between segments

export function accountsAt(position: number) {
  const p = Math.max(0, Math.min(1000, position));
  const segment = SEGMENTS.find((s) => p < s.end) ?? SEGMENTS[SEGMENTS.length - 1];
  const share = (p - segment.start) / (segment.end - segment.start);
  return Math.min(segment.to, segment.from + Math.floor(share * (segment.to - segment.from + 1)));
}

// The middle of the slider's stretch for `accounts`, so it reads back the same count.
export function positionOf(accounts: number) {
  const n = Math.max(1, Math.min(MAX_ACCOUNTS, Math.round(accounts)));
  const segment = SEGMENTS.find((s) => n <= s.to) ?? SEGMENTS[SEGMENTS.length - 1];
  return segment.start + ((n - segment.from + 0.5) / (segment.to - segment.from + 1)) * (segment.end - segment.start);
}

const money = (n: number) => (Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const plural = (n: number) => `${n} account${n === 1 ? "" : "s"}`;

function Feature({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 size-5 flex-none text-[#ffc48a]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
      <span>{children}</span>
    </li>
  );
}

export function PricingCalculator({ initial = 2, cta }: { initial?: number; cta?: ReactNode }) {
  const [accounts, setAccounts] = useState(initial);
  const bill = monthlyBill(accounts);
  const position = positionOf(accounts);

  // The bill spelled out, one chip per band reached (the free accounts first).
  const chips: { text: string; amount?: number; free?: boolean }[] = [{ text: `${plural(Math.min(accounts, FREE_ACCOUNTS))} free`, free: true }];
  const firstPaid = Math.max(0, Math.min(accounts, 10) - FREE_ACCOUNTS);
  if (firstPaid) chips.push({ text: `${plural(firstPaid)} × $5`, amount: firstPaid * 5 });
  for (const band of bill.bands.slice(1)) if (band.units) chips.push({ text: `${plural(band.units)} × ${money(band.perAccount)}`, amount: band.amount });

  return (
    <div>
      <div className="text-center">
        <p className="inline-flex items-center gap-2 text-sm text-[#FAF6F0]/60">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
          </svg>
          Your accounts
        </p>
        <p aria-live="polite" className="lp-display mt-2 text-7xl tabular-nums tracking-[-0.04em] md:text-8xl">
          {accounts.toLocaleString("en-US")}
        </p>
      </div>

      {/* One slider across the bands: the native range input sits on top for touch, keys and screen readers. */}
      <div className="relative mt-10">
        <div className="relative h-8">
          {SEGMENTS.map((s, i) => {
            const left = s.start / 10 + (i ? GAP / 2 : 0);
            const width = (s.end - s.start) / 10 - (i ? GAP / 2 : 0) - (i < SEGMENTS.length - 1 ? GAP / 2 : 0);
            const filled = Math.max(0, Math.min(1, (position - s.start) / (s.end - s.start)));
            return (
              <div key={s.label} className="absolute top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.1]" style={{ left: `${left}%`, width: `${width}%` }}>
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#9b6cff,#e7b8ff_60%,#ffd6a3)]" style={{ width: `${filled * 100}%` }} />
              </div>
            );
          })}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-[radial-gradient(130%_150%_at_50%_115%,#ffae5e_0%,#ffd6a3_40%,#fff6ea_80%)] shadow-[0_0_24px_rgba(255,170,100,0.6)]"
            style={{ left: `${position / 10}%` }}
          />
          <input
            type="range"
            aria-label="Number of connected accounts"
            aria-valuetext={plural(accounts)}
            min={0}
            max={1000}
            step={1}
            value={Math.round(position)}
            onChange={(event) => setAccounts(accountsAt(Number(event.target.value)))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <ol className="relative mt-3 h-12 text-sm" aria-label="Price per account">
          {SEGMENTS.map((s, i) => {
            const reached = accounts >= s.from;
            return (
              <li key={s.label} className="absolute" style={{ left: `${s.start / 10 + (i ? GAP / 2 : 0)}%` }}>
                <span aria-hidden="true" className={cn("mb-1.5 block h-2 w-px", reached ? "bg-[#ffc48a]" : "bg-white/20")} />
                <p className={cn("tabular-nums", reached ? "text-[#ffc48a]" : "text-[#FAF6F0]/40")}>{s.label}</p>
                <p className={reached ? "text-[#FAF6F0]" : "text-[#FAF6F0]/40"}>{s.price}</p>
              </li>
            );
          })}
        </ol>
      </div>

      <ul className="mt-10 flex flex-wrap gap-2.5" aria-label="How the price adds up">
        {chips.map((chip) => (
          <li key={chip.text} className={cn("rounded-full border px-4 py-2 text-sm tabular-nums", chip.free ? "border-[#ffc48a]/60 text-[#ffc48a]" : "border-white/12 bg-white/[0.03] text-[#FAF6F0]/80")}>
            {chip.text}
            {chip.amount !== undefined && <span className="text-[#FAF6F0]/40"> · </span>}
            {chip.amount !== undefined && <span className="text-[#ffc48a]">{money(chip.amount)}</span>}
          </li>
        ))}
      </ul>

      <div className="mt-8 grid gap-4 md:grid-cols-[1.35fr_1fr]">
        <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))]">
          <div className="p-6 md:p-8">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-xl font-medium">Post Social</span>
              <span className="text-[#FAF6F0]/55">Pay per account. Card only after {FREE_ACCOUNTS}.</span>
            </p>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
              <p className="tabular-nums">
                <span className="lp-display lp-ink text-6xl tracking-[-0.04em]">{bill.total === 0 ? "Free" : money(bill.total)}</span>
                {bill.total > 0 && <span className="ml-1.5 text-[#FAF6F0]/50">/month</span>}
              </p>
              <p className="pb-2 text-sm tabular-nums text-[#ffc48a]">
                {bill.total === 0 ? "No card needed" : `avg ${money(Math.round((bill.total / accounts) * 100) / 100)} per account`}
              </p>
            </div>
            {cta && <div className="mt-6 [&>*]:flex [&>*]:w-full [&>*]:justify-center">{cta}</div>}
          </div>
          <ul className="space-y-4 border-t border-white/[0.07] bg-[radial-gradient(80%_120%_at_20%_120%,rgba(255,170,100,0.12),transparent_60%)] p-6 text-[15px] text-[#FAF6F0]/80 md:p-8">
            <Feature icon={<><circle cx="10" cy="8" r="4" /><path d="M3 20a7 7 0 0 1 12-4.9M15.5 19l2 2 4-4" /></>}>{FREE_ACCOUNTS} accounts free to start, no card needed</Feature>
            <Feature icon={<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.8-1.2M12 15v2" /></>}>Every feature included: all 8 platforms, your AI agent, the API, analytics</Feature>
            <Feature icon={<><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M7 15h3" /></>}>Pay per account, cancel anytime</Feature>
            <Feature icon={<><path d="M4 16a8 8 0 1 1 16 0" /><path d="m12 16 4-5" /></>}>
              X posts at X&apos;s cost plus a little ({Math.round(X_PRICES.post * 100)}¢, {Math.round(X_PRICES.postWithLink * 100)}¢ with a link), with a monthly cap you set
            </Feature>
          </ul>
        </div>

        <div className="flex flex-col rounded-[22px] border border-white/[0.07] p-6 md:p-8">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-xl font-medium">Agencies</span>
            <span className="text-[#FAF6F0]/55">Hundreds of accounts?</span>
          </p>
          <p className="lp-display mt-6 text-5xl tracking-[-0.04em] text-[#FAF6F0]/85">$1</p>
          <p className="mt-1 text-sm text-[#FAF6F0]/55">per account from the 101st, and custom terms past {MAX_ACCOUNTS.toLocaleString("en-US")}.</p>
          <a href="mailto:support@postsocial.xyz?subject=Post%20Social%20for%20agencies" className="lp-glass mt-6 inline-flex h-11 items-center justify-center rounded-full px-5 text-sm text-[#FAF6F0] transition hover:bg-white/10">
            Talk to us
          </a>
          <p className="mt-auto pt-8 text-sm text-[#FAF6F0]/45">Same product, same price ladder. We&apos;ll help you move your clients over.</p>
        </div>
      </div>
    </div>
  );
}
