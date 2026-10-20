import Link from "next/link";
import { callServer, callServerResult, loadViewer } from "@/lib/beta/workspace";
import { cn } from "@/lib/utils";
import { addCard, manageBilling, saveXCap } from "./actions";

export const metadata = { title: "Billing · Post Social" };

type Line = { label: string; detail: string; amount: number };
export type BillingStatus = {
  plan: { id: string; name: string; comped: boolean };
  connected_accounts: number;
  free_accounts: number;
  subscription: { status: string } | null;
  // monthly_cap is the cap in force (null: not capped); set_cap is the one the workspace chose.
  x: { spent: number; posts: number; monthly_cap: number | null; set_cap: number; free_monthly: number };
  can_manage: boolean;
  available: boolean;
  upcoming: { total: number; period_start: string | null; period_end: string | null; lines: Line[] } | null;
  card: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
  details: { email: string | null; name: string | null; address: string | null } | null;
  invoices: Array<{ id: string; number: string | null; date: string | null; total: number; status: string; pdf: string | null; url: string | null }>;
};

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

const quiet = "inline-flex h-8 flex-none items-center rounded-lg border border-ps-fg/[0.12] px-3 text-xs text-ps-text hover:border-ps-fg/25";
const primary = "inline-flex h-8 flex-none items-center rounded-lg bg-ps-plum px-3 text-xs font-medium text-ps-ground";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string; saved?: string }> }) {
  const { workspace } = await loadViewer("/beta/billing");
  const { checkout, error, saved } = await searchParams;
  // Back from Stripe Checkout: confirm it here so Paid turns on without waiting for Stripe.
  if (workspace && checkout) await callServer("billing_confirm", { workspace_id: workspace.id, session_id: checkout });
  const result = workspace ? await callServerResult<BillingStatus>("billing_status", { workspace_id: workspace.id }) : null;
  const status = result?.data ?? null;
  const paying = Boolean(status?.subscription && status.subscription.status !== "canceled");
  const manage = Boolean(status?.can_manage && status.available && !status.plan.comped);

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-6 px-4 sm:px-8 pb-14 pt-5">
      <div>
        <h1 className="m-0 text-lg font-medium">Billing</h1>
        <p className="mt-1 text-ps-muted">
          Pay per connected account. First 2 are free. <Link href="/docs/billing" className="text-ps-plum-soft hover:text-ps-text">How it works</Link>
        </p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-ps-failed-text/30 px-4 py-3 text-sm text-ps-failed-text">{error}</p>}
      {checkout && paying && <p role="status" className="rounded-lg border border-ps-line px-4 py-3 text-sm text-ps-text">Card added. Connect as many accounts as you need.</p>}
      {saved === "x_cap" && <p role="status" className="rounded-lg border border-ps-line px-4 py-3 text-sm text-ps-text">Cap saved.</p>}

      {!workspace ? (
        <p className="text-sm text-ps-muted">You are not a member of any workspace yet.</p>
      ) : !status ? (
        <p role="alert" className="text-sm text-ps-failed-text">Billing could not be loaded. {result?.error ?? "Refresh the page to try again."}</p>
      ) : status.plan.comped ? (
        <Panel title={`${status.plan.name} plan`} note="This workspace isn't billed.">
          <p className="px-5 py-4 text-sm text-ps-muted">{status.connected_accounts} connected accounts.</p>
        </Panel>
      ) : (
        <>
          {status.upcoming && (
            <section aria-label="Upcoming invoice" className="rounded-xl border border-ps-line bg-ps-surface">
              <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-5 pt-6">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ps-subtle">
                    Upcoming invoice · {day(status.upcoming.period_start)} to {day(status.upcoming.period_end)}
                  </p>
                  <p className="mt-2 text-4xl font-semibold tracking-[-0.03em] text-ps-text tabular-nums">{money(status.upcoming.total)}</p>
                  <p className="mt-2 text-sm text-ps-muted">
                    {paying ? `Charged on ${day(status.upcoming.period_end, { month: "short", day: "numeric", year: "numeric" })}.` : `No card on file. ${status.free_accounts} accounts are free.`}
                  </p>
                </div>
                {manage && !paying && (
                  <form action={addCard}>
                    <Hidden id={workspace.id} />
                    <button type="submit" className={primary}>Add a card</button>
                  </form>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-ps-fg/[0.06] text-left font-mono text-[11px] uppercase tracking-[0.12em] text-ps-subtle">
                    <th className="px-6 py-2 font-normal">Item</th>
                    <th className="hidden px-6 py-2 font-normal sm:table-cell">Usage</th>
                    <th className="px-6 py-2 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {status.upcoming.lines.map((line) => (
                    <tr key={line.label} className="border-b border-ps-fg/[0.06]">
                      <td className="px-6 py-3 text-ps-text">
                        {line.label}
                        <span className="mt-0.5 block text-xs text-ps-subtle sm:hidden">{line.detail}</span>
                      </td>
                      <td className="hidden px-6 py-3 text-ps-muted sm:table-cell">{line.detail}</td>
                      <td className="px-6 py-3 text-right font-mono tabular-nums text-ps-text">{money(line.amount)}</td>
                    </tr>
                  ))}
                  <tr className="bg-ps-fg/[0.02]">
                    <td className="px-6 py-3.5 font-medium text-ps-text" colSpan={2}>{paying ? "Total charged to your card" : "Total"}</td>
                    <td className="px-6 py-3.5 text-right font-mono font-semibold tabular-nums text-ps-text">{money(status.upcoming.total)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Cost controls" note="Limits on what you can spend.">
              <div className="border-b border-ps-fg/[0.06] px-5 py-4">
                <p className="text-sm text-ps-text">X monthly cap</p>
                <p className="mt-1 text-xs text-ps-subtle">
                  {status.x.monthly_cap !== null ? `${money(status.x.spent)} of ${money(status.x.monthly_cap)} used. ` : ""}At the cap, X posts pause until next month.
                </p>
                {status.x.monthly_cap !== null && status.x.monthly_cap > 0 && status.x.spent >= status.x.monthly_cap * 0.8 && (
                  <p role="status" className="mt-1.5 text-xs text-ps-attention">{status.x.spent >= status.x.monthly_cap ? "X posts are paused." : "Close to your cap."}</p>
                )}
                {status.can_manage && (
                  <form action={saveXCap} className="mt-3 flex items-center gap-2">
                    <Hidden id={workspace.id} />
                    <label className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="text-ps-subtle">$</span>
                      <input name="monthly_cap" type="number" min={0} max={10000} step={1} defaultValue={status.x.set_cap} aria-label="X monthly cap in dollars" className="h-8 w-20 rounded-lg border border-ps-fg/[0.12] bg-transparent px-2 text-sm tabular-nums" />
                    </label>
                    <button type="submit" className={quiet}>Set cap</button>
                  </form>
                )}
                {!paying && <p className="mt-2 text-xs text-ps-subtle">Without a card, X is limited to {money(status.x.free_monthly)} a month.</p>}
              </div>
              {manage && paying && (
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="text-sm text-ps-text">Stop paying</p>
                    <p className="mt-1 text-xs text-ps-subtle">Go back to {status.free_accounts} free accounts at the end of the month.</p>
                  </div>
                  <form action={manageBilling}>
                    <Hidden id={workspace.id} />
                    <button type="submit" className={quiet}>Switch to Free</button>
                  </form>
                </div>
              )}
            </Panel>

            <Panel
              title="Payment method"
              note="Charged to your default card."
              footer="Cards are handled by Stripe."
              action={
                manage ? (
                  <form action={paying ? manageBilling : addCard}>
                    <Hidden id={workspace.id} />
                    <button type="submit" className={paying ? quiet : primary}>{paying ? "Change" : "Add card"}</button>
                  </form>
                ) : undefined
              }
            >
              {status.card ? (
                <div className="flex items-center gap-3 px-5 py-4">
                  <span className="rounded-md bg-ps-fg/[0.06] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ps-muted">{status.card.brand}</span>
                  <span>
                    <span className="block text-sm text-ps-text">{BRANDS[status.card.brand] ?? status.card.brand} •••• {status.card.last4}</span>
                    <span className="block text-xs text-ps-subtle">Expires {String(status.card.exp_month).padStart(2, "0")}/{status.card.exp_year}</span>
                  </span>
                </div>
              ) : (
                <p className="px-5 py-4 text-sm text-ps-muted">No card yet. You need one for a 3rd account.</p>
              )}
            </Panel>

            <Panel
              title="Billing details"
              note="Shown on your invoices."
              footer="Changes apply to future invoices."
              action={
                manage && status.details ? (
                  <form action={manageBilling}>
                    <Hidden id={workspace.id} />
                    <button type="submit" className={quiet}>Edit</button>
                  </form>
                ) : undefined
              }
            >
              {status.details ? (
                <dl className="space-y-2.5 px-5 py-4 text-sm">
                  {(
                    [
                      ["Email", status.details.email],
                      ["Name", status.details.name],
                      ["Address", status.details.address],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <dt className="text-ps-subtle">{label}</dt>
                      <dd className="m-0 text-right text-ps-text">{value || "None"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="px-5 py-4 text-sm text-ps-muted">Added with your first card.</p>
              )}
            </Panel>
          </div>

          <Panel title="Invoices" note="Every charge, with the PDF.">
            {!status.invoices?.length ? (
              <p className="px-5 py-4 text-sm text-ps-muted">No invoices yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {(status.invoices ?? []).map((invoice) => (
                    <tr key={invoice.id} className="border-b border-ps-fg/[0.06] last:border-b-0">
                      <td className="px-5 py-3 font-mono text-xs text-ps-subtle">{day(invoice.date)}</td>
                      <td className="px-5 py-3 text-ps-text">{day(invoice.date, { month: "long" })}</td>
                      <td className="hidden px-5 py-3 font-mono text-xs text-ps-subtle sm:table-cell">{invoice.number}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-ps-text">{money(invoice.total)}</td>
                      <td className="px-5 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px]", invoice.status === "paid" ? "bg-ps-live/15 text-ps-live" : "bg-ps-attention/15 text-ps-attention")}>{invoice.status}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {(invoice.pdf ?? invoice.url) && (
                          <a href={invoice.pdf ?? invoice.url ?? undefined} className="text-xs text-ps-plum-soft hover:text-ps-text" aria-label={`Download invoice ${invoice.number ?? ""}`}>
                            PDF
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          {!status.can_manage && <p className="text-xs text-ps-subtle">Only owners and admins can change billing.</p>}
        </>
      )}
    </div>
  );
}
