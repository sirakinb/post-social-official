import Link from "next/link";
import { cookies } from "next/headers";
import { BILLING_ERRORS, FLASH_COOKIE, noticeText, readFlash } from "@/lib/beta/flash";
import { callServer, callServerResult, loadViewer } from "@/lib/beta/workspace";
import { cn } from "@/lib/utils";
import { FREE_ACCOUNTS, PRICE_BANDS, X_PRICES } from "@/lib/pricing";
import { addCard, manageBilling, saveXCap } from "./actions";

export const metadata = { title: "Billing · Post Social" };

type Line = { label: string; detail: string; amount: number };
export type BillingStatus = {
  plan: { id: string; name: string; comped: boolean; account_limit?: number };
  // A working card on the paid plan (the backend's own test).
  paying?: boolean;
  connected_accounts: number;
  free_accounts: number;
  subscription: { status: string } | null;
  // Set when the paid plan is cancelling: the day it ends.
  ends_at?: string | null;
  estimate?: { monthly_total: number } | null;
  // monthly_cap is the cap in force (null: not capped); set_cap is the one the workspace chose.
  x: { spent: number; posts: number; monthly_cap: number | null; set_cap: number; free_monthly: number };
  can_manage: boolean;
  available: boolean;
  upcoming: { total: number; period_start: string | null; period_end: string | null; lines: Line[] } | null;
  card: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
  // Paid with Stripe Link instead of a plain card.
  link?: { email: string | null } | null;
  details: { email: string | null; name: string | null; address: string | null } | null;
  invoices: Array<{ id: string; number: string | null; date: string | null; total: number; status: string; pdf: string | null; url: string | null }>;
};

const cents = (n: number) => `${Math.round(n * 100)}¢`;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => (iso ? new Date(iso).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" }) : "");
const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover" };

function Panel({ title, note, action, footer, children, className }: { title: string; note?: string; action?: React.ReactNode; footer?: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("flex flex-col rounded-xl border border-ps-line bg-ps-surface", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-ps-fg/[0.06] px-5 py-4">
        <div>
          <h2 className="m-0 text-[15px] font-medium text-ps-text">{title}</h2>
          {note && <p className="mt-1 text-xs text-ps-subtle">{note}</p>}
        </div>
        {action}
      </div>
      <div className="flex-1">{children}</div>
      {footer && <p className="border-t border-ps-fg/[0.06] px-5 py-3 text-xs text-ps-subtle">{footer}</p>}
    </section>
  );
}

function Hidden({ id }: { id: string }) {
  return <input type="hidden" name="workspace_id" value={id} />;
}

const LADDER = [
  { from: 1, to: FREE_ACCOUNTS, label: `Accounts 1–${FREE_ACCOUNTS}`, price: "Free" },
  ...PRICE_BANDS.map((band) => ({
    from: Math.max(band.from, FREE_ACCOUNTS + 1),
    to: band.to,
    label: band.to === Infinity ? `Accounts ${band.from}+` : `Accounts ${Math.max(band.from, FREE_ACCOUNTS + 1)}–${band.to}`,
    price: `$${band.perAccount.toFixed(2).replace(/\.00$/, "")}/mo`,
  })),
];

// One dot per connected account (the free ones in green), capped so big workspaces stay tidy.
function AccountDots({ connected, free }: { connected: number; free: number }) {
  const shown = Math.min(connected, 24);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: Math.max(shown, free) }, (_, i) => (
        <span key={i} className={cn("size-3 rounded-full", i >= connected ? "border border-dashed border-ps-fg/20" : i < free ? "bg-ps-live" : "bg-ps-plum")} />
      ))}
      {connected > shown && <span className="ml-1 text-xs text-ps-subtle">+{connected - shown}</span>}
    </div>
  );
}

const quiet = "inline-flex h-8 flex-none items-center rounded-lg border border-ps-fg/[0.12] px-3 text-xs text-ps-text hover:border-ps-fg/25";
const primary = "inline-flex h-8 flex-none items-center rounded-lg bg-ps-plum px-3 text-xs font-medium text-ps-ground";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string; saved?: string }> }) {
  const { workspace } = await loadViewer("/beta/billing");
  const { checkout, error: errorCode, saved } = await searchParams;
  // Only known codes from the address are shown, in our own words (see lib/beta/flash).
  const error = noticeText(BILLING_ERRORS, errorCode, readFlash((await cookies()).get(FLASH_COOKIE)?.value, "error"));
  // Back from Stripe Checkout: confirm it here so Paid turns on without waiting for Stripe.
  if (workspace && checkout) await callServer("billing_confirm", { workspace_id: workspace.id, session_id: checkout });
  const result = workspace ? await callServerResult<BillingStatus>("billing_status", { workspace_id: workspace.id }) : null;
  const status = result?.data ?? null;
  const paying = Boolean(status?.paying ?? (status?.subscription && status.subscription.status !== "canceled"));
  const endsAt = status?.ends_at ?? null;
  const pastDue = status?.subscription?.status === "past_due";
  // A payment failed for good: Stripe stopped the plan but the subscription isn't cancelled.
  const stopped = Boolean(status?.subscription && !paying && status.subscription.status !== "canceled");
  const xPrice = `${cents(X_PRICES.post)} each (${cents(X_PRICES.postWithLink)} with a link)`;
  const manage = Boolean(status?.can_manage && status.available && !status.plan.comped);
  // A $0 limit means X needs a card (no free X allowance), not a used-up month: no bar or
  // "paused" warning then, only the note to add a card.
  const xLimit = status && status.x.monthly_cap !== null && status.x.monthly_cap > 0 ? status.x.monthly_cap : null;
  const near = Boolean(status && xLimit !== null && status.x.spent >= xLimit * 0.8);

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-6 px-4 sm:px-8 pb-14 pt-5">
      <div>
        <h1 className="m-0 text-lg font-medium">Billing</h1>
        <p className="mt-1 text-ps-muted">
          You only pay for the accounts you connect. <Link href="/docs/billing" className="text-ps-plum-soft hover:text-ps-text">How it works</Link>
        </p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-ps-failed-text/30 px-4 py-3 text-sm text-ps-failed-text">{error}</p>}
      {checkout && paying && (
        <p role="status" className="rounded-lg border border-ps-line px-4 py-3 text-sm text-ps-text">
          You&apos;re on the paid plan. <Link href="/beta/accounts#connect" className="text-ps-plum-soft hover:text-ps-text">Connect your next account</Link>
        </p>
      )}
      {saved === "x_cap" && <p role="status" className="rounded-lg border border-ps-line px-4 py-3 text-sm text-ps-text">X limit saved.</p>}
      {workspace && status && !status.plan.comped && pastDue && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ps-attention/40 px-4 py-3 text-sm text-ps-text">
          <span>Your last payment didn&apos;t go through. Update your card so your paid plan and X posts keep working.</span>
          {manage && (
            <form action={manageBilling}>
              <Hidden id={workspace.id} />
              <button type="submit" className={primary}>Update card</button>
            </form>
          )}
        </div>
      )}
      {workspace && status && !status.plan.comped && stopped && (
        <p role="alert" className="rounded-lg border border-ps-attention/40 px-4 py-3 text-sm text-ps-text">
          A payment failed, so your paid plan stopped. Add a card to start it again; your first {status.free_accounts} accounts stay free.
        </p>
      )}
      {workspace && status && !status.plan.comped && endsAt && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ps-line px-4 py-3 text-sm text-ps-text">
          <span>Your paid plan ends on {day(endsAt, { month: "long", day: "numeric" })}. No more charges after that; you keep {status.free_accounts} free accounts, and X posting stops.</span>
          {manage && (
            <form action={manageBilling}>
              <Hidden id={workspace.id} />
              <button type="submit" className={quiet}>Keep paid plan</button>
            </form>
          )}
        </div>
      )}

      {!workspace ? (
        <p className="text-sm text-ps-muted">You are not a member of any workspace yet.</p>
      ) : !status ? (
        <p role="alert" className="text-sm text-ps-failed-text">Billing could not be loaded. {result?.error ?? "Refresh the page to try again."}</p>
      ) : status.plan.comped ? (
        <Panel title={`${status.plan.name} plan`} note="This workspace isn't billed, including X posts.">
          <p className="px-5 py-4 text-sm text-ps-muted">
            {status.connected_accounts} of {status.plan.account_limit ?? "unlimited"} accounts connected
            {status.x.posts > 0 ? ` · ${status.x.posts} X ${status.x.posts === 1 ? "post" : "posts"} this month` : ""}.
          </p>
        </Panel>
      ) : (
        <>
          <section aria-label="Your month" className="grid overflow-hidden rounded-2xl border border-ps-line bg-ps-surface md:grid-cols-[1.4fr_1fr]">
            <div className="p-6">
              <p className="text-sm text-ps-muted">Connected accounts</p>
              <p className="mt-1 text-4xl font-semibold tracking-[-0.03em] text-ps-text tabular-nums">{status.connected_accounts}</p>
              <AccountDots connected={status.connected_accounts} free={status.free_accounts} />
              <p className="mt-3 text-xs text-ps-subtle">
                <span className="mr-1.5 inline-block size-2 rounded-full bg-ps-live align-middle" aria-hidden="true" />
                {status.free_accounts} on us, every month
              </p>
            </div>
            <div className="flex flex-col justify-between gap-4 border-t border-ps-line bg-ps-fg/[0.02] p-6 md:border-l md:border-t-0">
              <div>
                <p className="text-sm text-ps-muted">{paying ? (endsAt ? "Paid plan ends" : "Next charge") : "To pay"}</p>
                <p className="mt-1 text-4xl font-semibold tracking-[-0.03em] text-ps-text tabular-nums">
                  {paying && endsAt ? day(endsAt, { month: "short", day: "numeric" }) : money(paying ? status.upcoming?.total ?? 0 : 0)}
                </p>
                <p className="mt-2 text-xs text-ps-subtle">
                  {paying
                    ? endsAt
                      ? "No more charges after that."
                      : `On ${day(status.upcoming?.period_end ?? null, { month: "long", day: "numeric" })}.`
                    : status.connected_accounts > status.free_accounts
                      ? `You have ${status.connected_accounts} accounts: ${money(status.estimate?.monthly_total ?? 0)} a month once you add a card.`
                      : `Your first ${status.free_accounts} accounts are free. Add a card to post to X or to connect account ${status.free_accounts + 1} ($5 a month).`}
                </p>
              </div>
              {manage && !paying && (
                <form action={addCard} data-rewardful="true">
                  <Hidden id={workspace.id} />
                  <button type="submit" className={primary}>
                    {status.connected_accounts > status.free_accounts ? `Add a card · ${money(status.estimate?.monthly_total ?? 0)}/mo` : "Add a card · $0/mo"}
                  </button>
                </form>
              )}
            </div>
          </section>

          <section aria-label="Your rate" className="rounded-2xl border border-ps-line bg-ps-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-[15px] font-medium text-ps-text">Your rate</h2>
              <p className="text-xs text-ps-subtle">The more you connect, the less each one costs.</p>
            </div>
            <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LADDER.map((step) => {
                const here = Math.max(0, Math.min(status.connected_accounts, step.to) - (step.from - 1));
                const current = status.connected_accounts >= step.from && status.connected_accounts <= step.to;
                return (
                  <li key={step.from} aria-current={current ? "step" : undefined} className={cn("rounded-xl border px-3.5 py-3", current ? "border-ps-plum/60 bg-ps-plum/[0.08]" : "border-ps-fg/[0.08]")}>
                    <p className="text-xs text-ps-subtle">{step.label}</p>
                    <p className="mt-1 text-lg font-medium text-ps-text tabular-nums">{step.price}</p>
                    <p className="mt-1 text-xs text-ps-muted">{here > 0 ? `${here} of yours` : "\u00a0"}</p>
                  </li>
                );
              })}
            </ol>
            {status.x.posts > 0 && (
              <p className="mt-4 text-xs text-ps-subtle">
                Plus {status.x.posts} X {status.x.posts === 1 ? "post" : "posts"} this month, {money(status.x.spent)}{status.x.free_monthly > 0 ? ` with the first ${money(status.x.free_monthly)} free` : ""}.
              </p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="X spending">
              <div className="px-5 py-4">
                {xLimit !== null && (
                  <>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-ps-text tabular-nums">{money(status.x.spent)}</span>
                      <span className="text-xs text-ps-subtle">limit {money(xLimit)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ps-fg/[0.06]">
                      <div className={cn("h-full rounded-full", near ? "bg-ps-attention" : "bg-ps-plum")} style={{ width: `${Math.min(100, (status.x.spent / xLimit) * 100)}%` }} />
                    </div>
                  </>
                )}
                {near && (
                  <p role="status" className="mt-2 text-xs text-ps-attention">
                    {status.x.spent >= (xLimit ?? 0) ? "You've reached this month's X limit, so new X posts are paused. Raise the limit below to keep posting." : "Close to your X limit."}
                  </p>
                )}
                <p className="mt-3 text-xs text-ps-subtle">
                  {paying
                    ? status.x.set_cap === 0
                      ? "X posting is off: your monthly X limit is $0. Raise it to post to X."
                      : `X posts are ${xPrice}, added to your monthly bill. The monthly limit caps what X can cost: once this month's X posts reach it, new ones pause until next month or until you raise it.`
                    : `Posting to X needs a card. X posts are ${xPrice}, added to your monthly bill.`}
                </p>
                {!paying && manage && (
                  <form action={addCard} data-rewardful="true" className="mt-3">
                    <Hidden id={workspace.id} />
                    <button type="submit" className={primary}>Add a card</button>
                  </form>
                )}
                {!paying && !manage && status.available && <p className="mt-2 text-xs text-ps-subtle">Ask a workspace owner or admin to add a card.</p>}
                {/* The limit is only yours to set once you're paying. */}
                {status.can_manage && paying && (
                  <form action={saveXCap} className="mt-3 flex items-center gap-2">
                    <Hidden id={workspace.id} />
                    <label className="flex items-center gap-1.5">
                      <span className="text-xs text-ps-muted">Monthly limit</span>
                      <span aria-hidden="true" className="text-ps-subtle">$</span>
                      <input name="monthly_cap" type="number" min={0} max={10000} step={1} defaultValue={status.x.set_cap} aria-label="X monthly limit in dollars" className="h-8 w-20 rounded-lg border border-ps-fg/[0.12] bg-transparent px-2 text-sm tabular-nums" />
                    </label>
                    <button type="submit" className={quiet}>Save</button>
                  </form>
                )}
              </div>
            </Panel>

            <Panel
              title="Card and receipts"
              action={
                manage && paying ? (
                  <form action={manageBilling}>
                    <Hidden id={workspace.id} />
                    <button type="submit" className={quiet}>Update</button>
                  </form>
                ) : undefined
              }
            >
              <div className="border-b border-ps-fg/[0.06] px-5 py-4 text-sm">
                {status.card ? (
                  <p className="text-ps-text">
                    {BRANDS[status.card.brand] ?? status.card.brand} ending {status.card.last4}
                    <span className="ml-2 text-xs text-ps-subtle">exp {String(status.card.exp_month).padStart(2, "0")}/{String(status.card.exp_year).slice(-2)}</span>
                  </p>
                ) : status.link ? (
                  <p className="text-ps-text">
                    Link
                    {status.link.email && <span className="ml-2 text-xs text-ps-subtle">{status.link.email}</span>}
                  </p>
                ) : (
                  <p className="text-ps-muted">No card yet.</p>
                )}
                {status.details?.email && <p className="mt-1 text-xs text-ps-subtle">Receipts go to {status.details.email}</p>}
              </div>
              {!status.invoices?.length ? (
                <p className="px-5 py-4 text-sm text-ps-muted">Receipts show up here after your first charge.</p>
              ) : (
                <ul className="divide-y divide-ps-fg/[0.06]">
                  {status.invoices.map((invoice) => (
                    <li key={invoice.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <span className="flex-1 text-ps-text">{day(invoice.date, { month: "long", year: "numeric" })}</span>
                      {invoice.status !== "paid" && <span className="text-xs text-ps-attention">{invoice.status === "open" ? "Unpaid" : invoice.status}</span>}
                      <span className="font-mono tabular-nums text-ps-text">{money(invoice.total)}</span>
                      {(invoice.pdf ?? invoice.url) && (
                        <a href={invoice.pdf ?? invoice.url ?? undefined} className="text-xs text-ps-plum-soft hover:text-ps-text" aria-label={`Receipt for ${day(invoice.date, { month: "long", year: "numeric" })}`}>
                          View
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {manage && paying && !endsAt && (
            <form action={manageBilling} className="flex flex-wrap items-center gap-x-2 text-xs text-ps-subtle">
              <Hidden id={workspace.id} />
              <span>Done paying? You keep {status.free_accounts} free accounts; X posting stops.</span>
              <button type="submit" className="text-ps-muted underline underline-offset-2 hover:text-ps-text">Cancel paid plan</button>
            </form>
          )}
          {!status.can_manage && <p className="text-xs text-ps-subtle">Only owners and admins can change billing.</p>}
        </>
      )}
    </div>
  );
}
