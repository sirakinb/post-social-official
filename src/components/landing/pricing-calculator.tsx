"use client";

import { useState } from "react";
import { FREE_ACCOUNTS, X_PRICES, monthlyBill } from "@/lib/pricing";
import { cn } from "@/lib/utils";

// The sliding scale on the landing page: drag the number of accounts and watch each band
// of the ladder fill, with the monthly total and what each account works out to.

const MAX = 250;
const money = (n: number) => (Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const bandLabel = (from: number, to: number) => (to === Infinity ? `${from}+` : `${from}–${to}`);

// How full each band's bar is for `accounts`, 0 to 1 (the last band fills over 101–250).
function fill(accounts: number, from: number, to: number) {
  const end = to === Infinity ? MAX : to;
  return Math.max(0, Math.min(1, (accounts - (from - 1)) / (end - from + 1)));
}

export function PricingCalculator({ initial = 2 }: { initial?: number }) {
  const [accounts, setAccounts] = useState(initial);
  const bill = monthlyBill(accounts);
  const average = accounts > 0 ? bill.total / accounts : 0;
  const setFromInput = (value: string) => {
    const n = Math.round(Number(value));
    if (Number.isFinite(n)) setAccounts(Math.max(1, Math.min(2000, n)));
  };

  return (
    <div className="lp-card p-6 md:p-10">
      <div className="grid gap-10 md:grid-cols-[1.1fr_1fr] md:items-end">
        <div>
          <label htmlFor="pricing-accounts" className="lp-label">Connected accounts</label>
          <div className="mt-3 flex items-baseline gap-3">
            <input
              id="pricing-accounts"
              type="number"
              inputMode="numeric"
              min={1}
              max={2000}
              value={accounts}
              onChange={(event) => setFromInput(event.target.value)}
              className="lp-display w-28 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-4xl tabular-nums text-[#FAF6F0] outline-none focus:border-[#ffc48a]/60"
            />
            <span className="text-sm text-[#FAF6F0]/55">accounts</span>
          </div>
          <input
            type="range"
            aria-label="Number of connected accounts"
            min={1}
            max={MAX}
            value={Math.min(accounts, MAX)}
            onChange={(event) => setAccounts(Number(event.target.value))}
            className="mt-6 w-full accent-[#ffb46e]"
          />
          <div className="mt-1 flex justify-between text-[11px] text-[#FAF6F0]/40 tabular-nums">
            <span>1</span>
            <span>{MAX}+</span>
          </div>
        </div>

        <div className="md:text-right">
          <p className="lp-label">Your monthly price</p>
          <p aria-live="polite" className="mt-3 text-6xl tracking-[-0.04em] tabular-nums">
            <span className="lp-display lp-ink">{bill.total === 0 ? "Free" : money(bill.total)}</span>
            {bill.total > 0 && <span className="ml-1 text-lg text-[#FAF6F0]/50">/mo</span>}
          </p>
          <p className="mt-2 text-sm text-[#FAF6F0]/55">
            {bill.total === 0 ? `Free for up to ${FREE_ACCOUNTS} accounts. No card needed.` : `About ${money(Math.round(average * 100) / 100)} per account, first ${FREE_ACCOUNTS} free.`}
          </p>
        </div>
      </div>

      {/* The ladder: one row per band, lit as the slider passes through it. */}
      <ol className="mt-10 space-y-3" aria-label="Price per account by band">
        {bill.bands.map((band) => {
          const active = band.units > 0;
          return (
            <li key={band.from} className={cn("grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 rounded-xl px-4 py-3 transition sm:grid-cols-[5.5rem_1fr_9rem]", active ? "bg-white/[0.05]" : "opacity-55")}>
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#FAF6F0]/45">Accounts</p>
                <p className="lp-display text-lg tabular-nums">{bandLabel(band.from, band.to)}</p>
              </div>
              <div className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-white/[0.07] sm:order-none sm:col-span-1" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#9b6cff,#e7b8ff_55%,#ffe3bf)] transition-[width] duration-300"
                  style={{ width: `${fill(accounts, band.from, band.to) * 100}%` }}
                />
              </div>
              <div className="text-right">
                <p className="text-lg tabular-nums">
                  {money(band.perAccount)}
                  <span className="text-xs text-[#FAF6F0]/45"> /account</span>
                </p>
                <p className="text-[11px] tabular-nums text-[#FAF6F0]/45">{active ? `${band.units} × ${money(band.perAccount)} = ${money(band.amount)}` : "not reached"}</p>
              </div>
            </li>
          );
        })}
        <li className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-white/10 px-4 py-3 text-sm">
          <span className="text-[#FAF6F0]/70">Your first {FREE_ACCOUNTS} accounts, free every month</span>
          <span className="whitespace-nowrap tabular-nums text-[#ffc48a]">−{money(bill.credit)}</span>
        </li>
      </ol>

      <div className="mt-8 grid gap-3 text-sm text-[#FAF6F0]/60 sm:grid-cols-3">
        <p>Billed by the day: connect an account mid-month and you pay only for the days it&apos;s connected.</p>
        <p>
          X posts are extra, at X&apos;s own cost plus a little: {Math.round(X_PRICES.post * 100)}¢ a post, {Math.round(X_PRICES.postWithLink * 100)}¢ with a link. You set a monthly cap.
        </p>
        <p>Everything else is included: every platform, your AI agent, the API, scheduling and analytics.</p>
      </div>
    </div>
  );
}
