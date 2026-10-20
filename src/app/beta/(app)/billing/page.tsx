import Link from "next/link";
import { Card, CardHeader, Status } from "@/components/beta/ui";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import { addCard, manageBilling, saveXCap } from "./actions";

export const metadata = { title: "Billing · Post Social" };

export type BillingStatus = {
  plan: { id: string; name: string; comped: boolean };
  connected_accounts: number;
  free_accounts: number;
  subscription: { status: string } | null;
  estimate: { monthly_total: number; credit: number; bands: Array<{ units: number; perAccount: number; amount: number }> } | null;
  // monthly_cap is the cap in force (null: not capped); set_cap is the one the workspace chose.
  x: { spent: number; posts: number; monthly_cap: number | null; set_cap: number; price_per_post: number; price_per_link_post: number; free_monthly: number };
  can_manage: boolean;
  available: boolean;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const cents = (n: number) => `${Math.round(n * 100)}¢`;
const plural = (n: number) => `${n} account${n === 1 ? "" : "s"}`;

const STATUS: Record<string, { tone: "live" | "attention" | "failed"; label: string }> = {
  active: { tone: "live", label: "Card on file" },
  trialing: { tone: "live", label: "Card on file" },
  past_due: { tone: "attention", label: "Payment failed, Stripe is retrying" },
  unpaid: { tone: "failed", label: "Unpaid" },
  canceled: { tone: "failed", label: "Cancelled" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-ps-fg/[0.05] px-4 py-3 last:border-b-0">
      <span className="w-40 flex-none text-ps-subtle">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

const button = "inline-flex h-[34px] items-center rounded-lg px-3.5 text-[13px] font-medium";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string; saved?: string }> }) {
  const { workspace } = await loadViewer("/beta/billing");
  const { checkout, error, saved } = await searchParams;
  // Back from Stripe Checkout: confirm it here so Paid turns on without waiting for Stripe.
  if (workspace && checkout) await callServer("billing_confirm", { workspace_id: workspace.id, session_id: checkout });
  const status = workspace ? await callServer<BillingStatus>("billing_status", { workspace_id: workspace.id }) : null;

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-6 px-4 sm:px-8 pb-14 pt-5">
      <div>
        <h1 className="m-0 text-lg font-medium">Billing</h1>
        <p className="mt-1 text-ps-muted">
          Your first 2 accounts are free. After that you pay by the day for each connected account. <Link href="/docs/billing" className="text-ps-plum-soft hover:text-ps-text">How billing works</Link>
        </p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-ps-failed-text/30 px-4 py-3 text-sm text-ps-failed-text">{error}</p>}
      {checkout && status?.subscription && <p role="status" className="rounded-lg border border-ps-line px-4 py-3 text-sm text-ps-text">Card added. You can connect as many accounts as you need.</p>}
      {saved === "x_cap" && <p role="status" className="rounded-lg border border-ps-line px-4 py-3 text-sm text-ps-text">X cap saved.</p>}

      {!workspace ? (
        <p className="text-sm text-ps-muted">You are not a member of any workspace yet.</p>
      ) : !status ? (
        <p role="alert" className="text-sm text-ps-failed-text">Billing could not be loaded. Refresh the page to try again.</p>
      ) : (
        <>
          <Card aria-label="Plan">
            <CardHeader
              title="Plan"
              action={status.subscription ? <Status {...(STATUS[status.subscription.status] ?? { tone: "attention" as const, label: status.subscription.status })} /> : undefined}
            />
            <Row label="Plan">{status.plan.comped ? `${status.plan.name} (no charge)` : status.plan.name}</Row>
            <Row label="Connected accounts">
              {plural(status.connected_accounts)}
              {!status.subscription && !status.plan.comped && <span className="ml-2 text-xs text-ps-subtle">{status.free_accounts} free without a card</span>}
            </Row>
            {status.estimate && (
              <Row label="This month">
                <span className="text-ps-text">{status.estimate.monthly_total === 0 ? "Free" : `${money(status.estimate.monthly_total)} a month`}</span>
                <span className="mt-1 block text-xs text-ps-subtle">
                  {[...status.estimate.bands.map((b) => `${plural(b.units)} × ${money(b.perAccount)}`), ...(status.estimate.credit ? [`${money(status.estimate.credit)} monthly credit`] : [])].join(" · ")}
                  {status.estimate.monthly_total > 0 && " · charged by the day, so a month with fewer accounts costs less"}
                </span>
              </Row>
            )}
            {!status.plan.comped && status.can_manage && status.available && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                {status.subscription && status.subscription.status !== "canceled" ? (
                  <form action={manageBilling}>
                    <input type="hidden" name="workspace_id" value={workspace.id} />
                    <button type="submit" className={`${button} border border-ps-fg/[0.12] hover:border-ps-fg/25`}>Manage billing</button>
                  </form>
                ) : (
                  <form action={addCard}>
                    <input type="hidden" name="workspace_id" value={workspace.id} />
                    <button type="submit" className={`${button} bg-ps-plum text-ps-ground`}>Add a card</button>
                  </form>
                )}
                <span className="text-xs text-ps-subtle">
                  {status.subscription ? "Change your card, see invoices or cancel on Stripe's page." : "Needed for a 3rd account. Cards are handled by Stripe, we never see them."}
                </span>
              </div>
            )}
            {!status.can_manage && <p className="px-4 py-3.5 text-xs text-ps-subtle">Only owners and admins can change billing.</p>}
            {status.can_manage && !status.available && !status.plan.comped && <p className="px-4 py-3.5 text-xs text-ps-subtle">Billing isn&apos;t switched on here yet.</p>}
          </Card>

          <Card aria-label="X posts">
            <CardHeader title="X posts" />
            <Row label="Price">
              {cents(status.x.price_per_post)} a post, {cents(status.x.price_per_link_post)} with a link
              <span className="mt-1 block text-xs text-ps-subtle">X charges us for every post. The first {money(status.x.free_monthly)} each month is on us.</span>
            </Row>
            <Row label="This month">
              {money(status.x.spent)} <span className="text-ps-subtle">{status.x.monthly_cap !== null && `of ${money(status.x.monthly_cap)}`} · {status.x.posts} post{status.x.posts === 1 ? "" : "s"}</span>
              {status.x.monthly_cap !== null && status.x.monthly_cap > 0 && (
                <span className="mt-2 block h-1.5 max-w-xs overflow-hidden rounded-full bg-ps-fg/[0.06]" role="progressbar" aria-label="X spend this month" aria-valuenow={Math.round(Math.min(100, (status.x.spent / status.x.monthly_cap) * 100))} aria-valuemin={0} aria-valuemax={100}>
                  <span className={`block h-full ${status.x.spent >= status.x.monthly_cap * 0.8 ? "bg-warning" : "bg-ps-plum"}`} style={{ width: `${Math.min(100, (status.x.spent / status.x.monthly_cap) * 100)}%` }} />
                </span>
              )}
              {status.x.monthly_cap !== null && status.x.spent >= status.x.monthly_cap * 0.8 && (
                <span role="status" className="mt-1.5 block text-xs text-ps-attention">
                  {status.x.spent >= status.x.monthly_cap ? "X posts are paused until next month." : "Over 80% of this month's X cap."}{" "}
                  {status.subscription ? "Raise the cap below to keep posting." : "Add a card to go past the free $1."}
                </span>
              )}
            </Row>
            <Row label="Monthly cap">
              {status.can_manage ? (
                <form action={saveXCap} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="workspace_id" value={workspace.id} />
                  <label className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="text-ps-subtle">$</span>
                    <input
                      name="monthly_cap"
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      defaultValue={status.x.set_cap}
                      aria-label="Monthly X cap in dollars"
                      className="h-[34px] w-24 rounded-lg border border-ps-fg/[0.12] bg-transparent px-2.5 text-sm tabular-nums"
                    />
                  </label>
                  <button type="submit" className={`${button} border border-ps-fg/[0.12] hover:border-ps-fg/25`}>Save</button>
                </form>
              ) : (
                money(status.x.set_cap)
              )}
              <span className="mt-1 block text-xs text-ps-subtle">
                {status.plan.comped
                  ? "Your plan isn't charged for X posts."
                  : `At the cap, X posts pause until next month; other platforms keep posting.${status.subscription ? "" : ` Without a card, X stops at the free ${money(status.x.free_monthly)}.`}`}
              </span>
            </Row>
          </Card>
        </>
      )}
    </div>
  );
}
