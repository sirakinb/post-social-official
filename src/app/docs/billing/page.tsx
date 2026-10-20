import Link from "next/link";
import { Brand } from "@/components/brand";
import { FREE_ACCOUNTS, MONTHLY_CREDIT, PRICE_BANDS, X_PRICES, monthlyBill } from "@/lib/pricing";

export const metadata = {
  title: "Docs: pricing and billing · Post Social",
  description: "How Post Social bills: your first 2 accounts are free, then you pay by the day for each connected account, with X posts at cost plus a little and a monthly cap.",
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const cents = (n: number) => `${Math.round(n * 100)}¢`;
const band = (b: (typeof PRICE_BANDS)[number]) => (b.to === Infinity ? `${b.from}+` : `${b.from}–${b.to}`);

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 id={id} className="mt-12 text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

// One worked example: the bill for `accounts`, line by line.
function Example({ accounts }: { accounts: number }) {
  const bill = monthlyBill(accounts);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-sm font-semibold text-ink">{accounts} accounts all month</p>
      <ul className="mt-2 space-y-1 font-mono text-xs text-ink-muted">
        {bill.bands.filter((b) => b.units).map((b) => (
          <li key={b.from} className="flex justify-between gap-4"><span>{b.units} × {money(b.perAccount)}</span><span>{money(b.amount)}</span></li>
        ))}
        <li className="flex justify-between gap-4"><span>Monthly credit</span><span>−{money(bill.credit)}</span></li>
        <li className="flex justify-between gap-4 border-t border-border pt-1 text-ink"><span>Total</span><span>{money(bill.total)}</span></li>
      </ul>
    </div>
  );
}

export default function BillingDocsPage() {
  return (
    <div className="technical-grid min-h-screen">
      <header className="border-b border-border bg-[#080610]/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 md:px-8">
          <Brand size="sm" />
          <nav className="flex gap-4 text-sm">
            <Link href="/docs" className="text-ink-muted hover:text-ink">Docs</Link>
            <a href="#accounts" className="text-ink-muted hover:text-ink">Accounts</a>
            <a href="#x" className="text-ink-muted hover:text-ink">X posts</a>
            <a href="#invoices" className="text-ink-muted hover:text-ink">Invoices</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 md:px-8">
        <p className="utility-label text-accent">Post Social / Docs / Billing</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink">Pricing and billing</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Your first {FREE_ACCOUNTS} accounts are free, with no card needed. After that you pay for what you use: each connected account, by the day, and X posts at about what X charges us. Every
          feature is included at every size.
        </p>

        <Section id="accounts" title="Connected accounts">
          <p>
            You pay for each social account you connect (an Instagram account, a Facebook Page, a YouTube channel, and so on). The price per account drops as you grow, and each step only applies to
            the accounts in it:
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-subtle"><th className="px-4 py-2 font-medium">Accounts</th><th className="px-4 py-2 text-right font-medium">Per account, per month</th></tr></thead>
              <tbody className="divide-y divide-border">
                {PRICE_BANDS.map((b) => (
                  <tr key={b.from}><td className="px-4 py-2 font-mono text-ink">{band(b)}</td><td className="px-4 py-2 text-right text-ink">{money(b.perAccount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Every workspace gets a {money(MONTHLY_CREDIT)} credit each month, which covers your first {FREE_ACCOUNTS} accounts. So with {FREE_ACCOUNTS} or fewer you pay nothing, and you need a card only
            to connect a {FREE_ACCOUNTS + 1}rd.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <Example accounts={5} />
            <Example accounts={12} />
            <Example accounts={150} />
          </div>
        </Section>

        <Section id="by-the-day" title="Billed by the day">
          <p>
            You pay at the start of each billing month for the accounts you have then. Connect an account halfway through the month and the next invoice includes it for the days you had it;
            disconnect one and the unused days are credited back. Nothing to switch on: connecting and disconnecting in Post Social is enough.
          </p>
          <p>
            Example: you have 4 accounts ({money(monthlyBill(4).total)} a month) and connect a 5th halfway through. The next invoice adds about {money((monthlyBill(5).total - monthlyBill(4).total) / 2)} for
            the half month, then {money(monthlyBill(5).total)} for the month ahead.
          </p>
        </Section>

        <Section id="x" title="X posts">
          <p>
            X charges Post Social for every post made through its API, so X posts are billed on top: {cents(X_PRICES.post)} a post, or {cents(X_PRICES.postWithLink)} when the text has a link (X charges
            much more for links). The first {money(X_PRICES.freeMonthly)} of X posts each month is free. Reading posts and stats costs you nothing.
          </p>
          <p>
            You set a monthly X cap on the Billing page ({money(X_PRICES.defaultMonthlyCap)}{" "}to start). The Billing page warns you once you&apos;ve used 80%. At the cap, X posts pause until the next
            month and say so in the post&apos;s result; your other platforms keep posting. Without a card, X stops at the free {money(X_PRICES.freeMonthly)}.
          </p>
          <p>Tip: leave links out of X posts (put them in a reply or your bio) and each post costs {cents(X_PRICES.post)} instead of {cents(X_PRICES.postWithLink)}.</p>
        </Section>

        <Section id="invoices" title="Cards, invoices and cancelling">
          <p>
            Add a card on the <Link href="/beta/billing" className="text-accent hover:underline">Billing page</Link>. Payments are handled by Stripe; Post Social never sees your card. Manage billing
            opens Stripe&apos;s page, where you change your card, download invoices and receipts, or cancel.
          </p>
          <p>
            Each invoice lists your accounts by price step, the {money(MONTHLY_CREDIT)}{" "}credit, any changes during the month, and last month&apos;s X posts. If a payment fails, Stripe tries again for a
            few days and your posts keep going in the meantime. Cancel any time: you keep the rest of the month you paid for, then the workspace goes back to Free. Nothing is deleted, but posting
            pauses until you&apos;re down to {FREE_ACCOUNTS} connected accounts or add a card again.
          </p>
          <p>Only the workspace owner and admins can change billing. Questions or more than 2,000 accounts: <a href="mailto:support@postsocial.xyz" className="text-accent hover:underline">support@postsocial.xyz</a>.</p>
        </Section>

        <p className="mt-12 text-xs text-ink-subtle"><Link href="/docs" className="hover:underline">Back to the docs</Link> · <Link href="/#pricing" className="hover:underline">Pricing calculator</Link></p>
      </main>
    </div>
  );
}
