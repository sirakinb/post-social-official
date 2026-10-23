// Billing with Stripe. Each workspace has at most one subscription with one item, "Post
// Social accounts", whose quantity is the number of connected accounts. The price is
// graduated (first 2 free, then $5, $2.50, $1), so Stripe works out the sliding scale and
// prorates every change by the day. An active subscription puts the workspace on the Paid
// plan; without one it stays on Free (2 accounts). Cards, invoices and cancelling happen on
// Stripe's own pages (Checkout and the customer portal); we never see card details.
import { ApiError, membership, requireUuid, type Caller, type Sql } from "./access";
import { FREE_ACCOUNTS, X_PRICES, monthlyBill } from "./pricing";
import { originAllowedFor } from "./connections/service";

export const ACCOUNTS_PRICE_LOOKUP_KEY = "post_social_accounts_monthly";

// Statuses that keep the Paid plan. past_due keeps it while Stripe retries the card.
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

type Params = Record<string, unknown>;

export type Stripe = {
  request<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params?: Params): Promise<T>;
};

// Stripe's form encoding: nested objects and arrays become key[sub][0]=value.
export function formEncode(params: Params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, i) => (typeof item === "object" && item ? formEncode(item as Params, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(item))));
    else if (typeof value === "object") formEncode(value as Params, name, out);
    else out.append(name, String(value));
  }
  return out;
}

export function createStripe(secretKey: string, fetchImpl: typeof fetch = fetch): Stripe {
  return {
    async request(method, path, params = {}) {
      const body = formEncode(params);
      const url = method === "GET" && [...body].length ? `https://api.stripe.com${path}?${body}` : `https://api.stripe.com${path}`;
      const response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2025-03-31.basil" },
        body: method === "GET" ? undefined : body,
      });
      const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(`Stripe ${method} ${path} failed (${response.status}): ${json?.error?.message ?? "no details"}`);
      return json as never;
    },
  };
}

// allowedOrigins: web app addresses (WEB_APP_ORIGINS) Stripe may send people back to, so a
// preview or local copy of the app gets them back to itself; anything else uses webAppUrl.
export type BillingDeps = { sql: Sql; stripe: Stripe | null; webAppUrl: string; allowedOrigins?: string[] };

function returnBase(deps: BillingDeps, input: Params) {
  const origin = typeof input.return_origin === "string" ? input.return_origin : "";
  return origin && originAllowedFor(origin, deps.allowedOrigins ?? []) ? new URL(origin).origin : deps.webAppUrl;
}

type BillingRow = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  billed_quantity: number | null;
  x_monthly_cap_cents: number;
};

function requireStripe(deps: BillingDeps): Stripe {
  if (!deps.stripe) throw new ApiError(503, "Billing isn't available right now. Contact support@postsocial.xyz.");
  return deps.stripe;
}

async function managerOf(sql: Sql, caller: Caller, workspaceId: string) {
  const member = await membership(sql, caller, workspaceId, true, "Reviewers can't change billing.");
  if (member.role !== "owner" && member.role !== "admin") throw new ApiError(403, "Only the workspace owner or an admin can change billing.");
  return member;
}

async function workspaceState(sql: Sql, workspaceId: string) {
  const [row] = await sql<{ plan_id: string; plan_name: string; connected: number } & Partial<BillingRow>>(
    `SELECT p.id AS plan_id, p.name AS plan_name,
            (SELECT count(*)::int FROM public.connected_accounts a WHERE a.workspace_id = $1 AND a.health <> 'disconnected') AS connected,
            b.stripe_customer_id, b.stripe_subscription_id, b.subscription_status, b.billed_quantity, b.x_monthly_cap_cents
     FROM public.plans p
     LEFT JOIN public.workspace_billing b ON b.workspace_id = $1
     WHERE p.id = coalesce((SELECT plan_id FROM public.workspace_plans WHERE workspace_id = $1), 'tester')`,
    [workspaceId],
  );
  return row;
}

let cachedPriceId: string | null = null;
async function accountsPriceId(stripe: Stripe) {
  if (cachedPriceId) return cachedPriceId;
  const prices = await stripe.request<{ data: { id: string }[] }>("GET", "/v1/prices", { lookup_keys: [ACCOUNTS_PRICE_LOOKUP_KEY], active: true });
  const id = prices.data[0]?.id;
  if (!id) throw new Error(`No active Stripe price with lookup key ${ACCOUNTS_PRICE_LOOKUP_KEY}`);
  cachedPriceId = id;
  return id;
}

// Saves what a Stripe subscription says and moves the workspace between Free and Paid.
export async function recordSubscription(sql: Sql, workspaceId: string, subscription: { id: string; status: string; customer: string; items?: { data?: { quantity?: number }[] } }) {
  const paid = PAID_STATUSES.has(subscription.status);
  await sql(
    `WITH saved AS (
       INSERT INTO public.workspace_billing (workspace_id, stripe_customer_id, stripe_subscription_id, subscription_status, billed_quantity, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (workspace_id) DO UPDATE SET
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         subscription_status = EXCLUDED.subscription_status,
         billed_quantity = coalesce(EXCLUDED.billed_quantity, workspace_billing.billed_quantity),
         updated_at = now()
       RETURNING workspace_id
     )
     SELECT public.set_billing_plan(workspace_id, $6) FROM saved`,
    [workspaceId, subscription.customer, subscription.id, subscription.status, subscription.items?.data?.[0]?.quantity ?? null, paid],
  );
  return paid;
}

// Brings the subscription's quantity in line with the connected accounts. Stripe prorates
// the change by the day. Safe to call often: it does nothing when they already match.
export async function syncAccountQuantity(deps: BillingDeps, workspaceId: string) {
  if (!deps.stripe) return null;
  const state = await workspaceState(deps.sql, workspaceId);
  if (!state?.stripe_subscription_id || !PAID_STATUSES.has(state.subscription_status ?? "")) return null;
  if (state.billed_quantity === state.connected) return state.connected;
  const subscription = await deps.stripe.request<{ items: { data: { id: string }[] } }>("GET", `/v1/subscriptions/${state.stripe_subscription_id}`);
  const item = subscription.items.data[0];
  if (!item) throw new Error(`Subscription ${state.stripe_subscription_id} has no items`);
  await deps.stripe.request("POST", `/v1/subscription_items/${item.id}`, { quantity: state.connected, proration_behavior: "create_prorations" });
  await deps.sql(`UPDATE public.workspace_billing SET billed_quantity = $2, updated_at = now() WHERE workspace_id = $1`, [workspaceId, state.connected]);
  return state.connected;
}

// The Billing page: plan, accounts, this month's estimate, X cap, and what the person can do.
export async function billingStatus(deps: BillingDeps, caller: Caller, input: Params) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  const member = await membership(deps.sql, caller, workspaceId, false);
  if (deps.stripe) await syncAccountQuantity(deps, workspaceId).catch(() => null);
  const state = await workspaceState(deps.sql, workspaceId);
  const comped = state.plan_id !== "free" && state.plan_id !== "paid";
  const bill = monthlyBill(state.connected);
  // Without a working card, X stops at the free $1 (comped plans aren't capped).
  const billable = state.plan_id === "paid" && PAID_STATUSES.has(state.subscription_status ?? "");
  const setCap = (state.x_monthly_cap_cents ?? 1000) / 100;
  const effectiveCap = comped ? null : billable ? setCap : Math.min(setCap, X_PRICES.freeMonthly);
  const xSpend = await xSpendThisMonth(deps.sql, workspaceId);
  return {
    plan: { id: state.plan_id, name: state.plan_name, comped },
    connected_accounts: state.connected,
    free_accounts: FREE_ACCOUNTS,
    subscription: state.stripe_subscription_id ? { status: state.subscription_status } : null,
    estimate: comped ? null : { monthly_total: bill.total, credit: bill.credit, bands: bill.bands.filter((b) => b.units > 0) },
    x: { ...xSpend, monthly_cap: effectiveCap, set_cap: (state.x_monthly_cap_cents ?? 1000) / 100, price_per_post: X_PRICES.post, price_per_link_post: X_PRICES.postWithLink, free_monthly: X_PRICES.freeMonthly },
    can_manage: member.role === "owner" || member.role === "admin",
    available: Boolean(deps.stripe),
    ...(await stripeDetails(deps, state, bill.total, xSpend.spent, comped)),
  };
}

type Card = { brand: string; last4: string; exp_month: number; exp_year: number };
type StripeInvoice = { id: string; number: string | null; created: number; period_start: number; period_end: number; total: number; status: string; invoice_pdf: string | null; hosted_invoice_url: string | null };
const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

// What Stripe knows: the next invoice, the card, billing details and past invoices. Each
// part is best effort, so the page still loads if Stripe is slow or down.
async function stripeDetails(deps: BillingDeps, state: Awaited<ReturnType<typeof workspaceState>>, estimate: number, xSpent: number, comped: boolean) {
  const xLine = (amount: number) => ({ label: "X posts", detail: "This month so far", amount });
  const xBillable = Math.max(0, Math.round((xSpent - X_PRICES.freeMonthly) * 100) / 100);
  const fallbackEnd = new Date(Date.UTC(monthStart().getUTCFullYear(), monthStart().getUTCMonth() + 1, 0));
  const ourUpcoming = {
    total: Math.round((estimate + xBillable) * 100) / 100,
    period_start: monthStart().toISOString(),
    period_end: fallbackEnd.toISOString(),
    lines: [
      { label: "Connected accounts", detail: `${state.connected} connected · ${Math.min(state.connected, FREE_ACCOUNTS)} free`, amount: estimate },
      ...(xSpent > 0 ? [xLine(xBillable)] : []),
    ],
  };
  const empty = { upcoming: comped ? null : ourUpcoming, card: null as Card | null, details: null as { email: string | null; name: string | null; address: string | null } | null, invoices: [] as Array<Record<string, unknown>> };
  if (!deps.stripe || !state.stripe_customer_id) return empty;
  const stripe = deps.stripe;
  const customerId = state.stripe_customer_id;
  const [customer, subscription, invoices, preview] = await Promise.all([
    stripe.request<{ email: string | null; name: string | null; address: Record<string, string | null> | null; invoice_settings?: { default_payment_method?: { card?: Card } | null } }>("GET", `/v1/customers/${customerId}`, { expand: ["invoice_settings.default_payment_method"] }).catch(() => null),
    state.stripe_subscription_id
      ? stripe.request<{ default_payment_method?: { card?: Card } | null }>("GET", `/v1/subscriptions/${state.stripe_subscription_id}`, { expand: ["default_payment_method"] }).catch(() => null)
      : null,
    stripe.request<{ data: StripeInvoice[] }>("GET", "/v1/invoices", { customer: customerId, limit: 12 }).catch(() => null),
    state.stripe_subscription_id && PAID_STATUSES.has(state.subscription_status ?? "")
      ? stripe.request<{ total: number; period_start: number; period_end: number; next_payment_attempt: number | null; lines: { data: Array<{ amount: number; description: string | null; quantity?: number | null }> } }>("POST", "/v1/invoices/create_preview", { customer: customerId, subscription: state.stripe_subscription_id }).catch(() => null)
      : null,
  ]);
  const a = customer?.address;
  const card = subscription?.default_payment_method?.card ?? customer?.invoice_settings?.default_payment_method?.card ?? null;
  const upcoming = preview
    ? {
        total: Math.round((preview.total / 100 + xBillable) * 100) / 100,
        period_start: iso(preview.period_start),
        period_end: iso(preview.next_payment_attempt ?? preview.period_end),
        lines: [
          { label: "Connected accounts", detail: `${state.connected} connected · ${Math.min(state.connected, FREE_ACCOUNTS)} free`, amount: preview.total / 100 },
          ...(xSpent > 0 ? [xLine(xBillable)] : []),
        ],
      }
    : ourUpcoming;
  return {
    upcoming: comped ? null : upcoming,
    card: card ? { brand: card.brand, last4: card.last4, exp_month: card.exp_month, exp_year: card.exp_year } : null,
    details: customer
      ? { email: customer.email, name: customer.name, address: a ? [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(", ") || null : null }
      : null,
    invoices: (invoices?.data ?? [])
      .filter((i) => i.status !== "draft" && i.status !== "void")
      .map((i) => ({ id: i.id, number: i.number, date: iso(i.created), total: i.total / 100, status: i.status, pdf: i.invoice_pdf, url: i.hosted_invoice_url })),
  };
}

// DataFast ties revenue to the marketing channel a visitor came from. It reads these two ids
// from the checkout's metadata; the website passes them on from the visitor's cookies. Anything
// that doesn't look like an id is dropped.
function datafastMetadata(input: Params) {
  const metadata: Record<string, string> = {};
  for (const key of ["datafast_visitor_id", "datafast_session_id"]) {
    const value = input[key];
    if (typeof value === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(value)) metadata[key] = value;
  }
  return metadata;
}

// Sends the person to Stripe Checkout to add a card and start the subscription.
export async function startCheckout(deps: BillingDeps, caller: Caller, input: Params) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await managerOf(deps.sql, caller, workspaceId);
  const stripe = requireStripe(deps);
  const state = await workspaceState(deps.sql, workspaceId);
  if (state.plan_id !== "free" && state.plan_id !== "paid") throw new ApiError(409, "This workspace isn't billed. Contact support@postsocial.xyz to change that.");
  if (state.stripe_subscription_id && PAID_STATUSES.has(state.subscription_status ?? "")) throw new ApiError(409, "Billing is already set up. Use Manage billing to change your card.");
  const session = await stripe.request<{ url: string }>("POST", "/v1/checkout/sessions", {
    mode: "subscription",
    client_reference_id: workspaceId,
    customer: state.stripe_customer_id ?? undefined,
    line_items: [{ price: await accountsPriceId(stripe), quantity: Math.max(1, state.connected) }],
    subscription_data: { metadata: { workspace_id: workspaceId } },
    metadata: { workspace_id: workspaceId, ...datafastMetadata(input) },
    payment_method_collection: "always",
    allow_promotion_codes: true,
    success_url: `${returnBase(deps, input)}/beta/billing?checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnBase(deps, input)}/beta/billing`,
  });
  return { url: session.url };
}

// Back from Checkout: confirms the session belongs to this workspace and turns on Paid,
// without waiting for Stripe's webhook.
export async function confirmCheckout(deps: BillingDeps, caller: Caller, input: Params) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await managerOf(deps.sql, caller, workspaceId);
  const stripe = requireStripe(deps);
  const sessionId = typeof input.session_id === "string" && /^cs_[A-Za-z0-9_]{10,200}$/.test(input.session_id) ? input.session_id : null;
  if (!sessionId) throw new ApiError(400, "That checkout link isn't valid.");
  const session = await stripe.request<{ client_reference_id: string | null; status: string; subscription: { id: string; status: string; customer: string; items: { data: { quantity: number }[] } } | null }>(
    "GET",
    `/v1/checkout/sessions/${sessionId}`,
    { expand: ["subscription"] },
  );
  if (session.client_reference_id !== workspaceId) throw new ApiError(404, "That checkout wasn't for this workspace.");
  if (session.status !== "complete" || !session.subscription) return { paid: false };
  return { paid: await recordSubscription(deps.sql, workspaceId, session.subscription) };
}

// Stripe's customer portal: change card, see invoices, cancel.
export async function openPortal(deps: BillingDeps, caller: Caller, input: Params) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await managerOf(deps.sql, caller, workspaceId);
  const stripe = requireStripe(deps);
  const state = await workspaceState(deps.sql, workspaceId);
  if (!state.stripe_customer_id) throw new ApiError(409, "Add a card first.");
  const portal = await stripe.request<{ url: string }>("POST", "/v1/billing_portal/sessions", { customer: state.stripe_customer_id, return_url: `${returnBase(deps, input)}/beta/billing` });
  return { url: portal.url };
}

export async function setXCap(deps: BillingDeps, caller: Caller, input: Params) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await managerOf(deps.sql, caller, workspaceId);
  const dollars = Number(input.monthly_cap);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 10000) throw new ApiError(400, "Set a monthly X cap between $0 and $10,000.");
  const cents = Math.round(dollars * 100);
  await deps.sql(
    `INSERT INTO public.workspace_billing (workspace_id, x_monthly_cap_cents) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET x_monthly_cap_cents = EXCLUDED.x_monthly_cap_cents, updated_at = now()`,
    [workspaceId, cents],
  );
  return { monthly_cap: cents / 100 };
}

// The database refuses an account over the plan's limit ("Your Free plan allows 2 connected
// accounts..."). On Free, say how to get more instead.
export function accountLimitMessage(error: unknown, webAppUrl?: string): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Your (.+?) plan allows (\d+) connected accounts/);
  if (!match) return null;
  if (match[1] === "Free") {
    return `Your first ${FREE_ACCOUNTS} accounts are free. To connect more, add a card on the Billing page${webAppUrl ? ` (${webAppUrl}/beta/billing)` : ""}: $5 a month per account, billed by the day.`;
  }
  return `Your ${match[1]} plan allows ${match[2]} connected accounts. Disconnect one first, or contact support@postsocial.xyz.`;
}

export function billingActions(deps: BillingDeps) {
  return {
    billing_status: (_sql: Sql, caller: Caller, input: Params) => billingStatus(deps, caller, input),
    billing_checkout: (_sql: Sql, caller: Caller, input: Params) => startCheckout(deps, caller, input),
    billing_confirm: (_sql: Sql, caller: Caller, input: Params) => confirmCheckout(deps, caller, input),
    billing_portal: (_sql: Sql, caller: Caller, input: Params) => openPortal(deps, caller, input),
    billing_x_cap: (_sql: Sql, caller: Caller, input: Params) => setXCap(deps, caller, input),
  };
}

// ===== Stripe webhook =====

const toHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

// Checks Stripe's signature header (t=..., v1=...) over the raw body, within 5 minutes.
export async function verifyStripeSignature(body: string, header: string | null, secret: string, now = Date.now()) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !signatures.length || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type StripeEvent = { type: string; data: { object: Record<string, unknown> } };

const MONTH_NAME = (month: string) => new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// A renewal invoice is a draft for about an hour before Stripe charges it: add the X posts
// not billed yet, month by month, each month's first $1 free.
export async function addXUsageToInvoice(deps: BillingDeps, invoice: { id: string; customer: string; status?: string; billing_reason?: string }) {
  if (invoice.status !== "draft" || invoice.billing_reason !== "subscription_cycle") return { added: 0 };
  const stripe = requireStripe(deps);
  const months = await deps.sql<{ workspace_id: string; month: string; posts: number; link_posts: number; total_cents: number; billed_cents: number }>(
    `WITH ws AS (SELECT workspace_id FROM public.workspace_billing WHERE stripe_customer_id = $1)
     SELECT c.workspace_id, to_char(date_trunc('month', c.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS month,
            count(*)::int AS posts, count(*) FILTER (WHERE c.with_link)::int AS link_posts, sum(c.cents)::int AS total_cents,
            coalesce((SELECT sum(l.cents)::int FROM public.x_invoice_lines l
                      WHERE l.workspace_id = c.workspace_id AND l.month = date_trunc('month', c.created_at AT TIME ZONE 'UTC')::date), 0) AS billed_cents
     FROM public.x_charges c JOIN ws USING (workspace_id)
     GROUP BY 1, 2 ORDER BY 2`,
    [invoice.customer],
  );
  const free = Math.round(X_PRICES.freeMonthly * 100);
  let added = 0;
  for (const m of months) {
    const cents = Math.max(0, m.total_cents - free) - m.billed_cents;
    if (cents <= 0) continue;
    // Saved first, so a repeated webhook can't add the same line twice.
    const [saved] = await deps.sql(
      `INSERT INTO public.x_invoice_lines (stripe_invoice_id, workspace_id, month, cents) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING month`,
      [invoice.id, m.workspace_id, m.month, cents],
    );
    if (!saved) continue;
    try {
      await stripe.request("POST", "/v1/invoiceitems", {
        customer: invoice.customer,
        invoice: invoice.id,
        currency: "usd",
        amount: cents,
        description: `X posts, ${MONTH_NAME(m.month)}: ${m.posts} post${m.posts === 1 ? "" : "s"}${m.link_posts ? ` (${m.link_posts} with a link)` : ""}, first $${X_PRICES.freeMonthly} free`,
        metadata: { workspace_id: m.workspace_id, month: m.month },
      });
    } catch (error) {
      await deps.sql(`DELETE FROM public.x_invoice_lines WHERE stripe_invoice_id = $1 AND month = $2`, [invoice.id, m.month]);
      throw error;
    }
    added += cents;
  }
  return { added };
}

// This month's X spend so far, for the Billing page.
async function xSpendThisMonth(sql: Sql, workspaceId: string) {
  const [row] = await sql<{ cents: number; posts: number }>(
    `SELECT coalesce(sum(cents), 0)::int AS cents, count(*)::int AS posts FROM public.x_charges
     WHERE workspace_id = $1 AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [workspaceId],
  );
  return { spent: (row?.cents ?? 0) / 100, posts: row?.posts ?? 0 };
}

// Subscription changes from Stripe (card added, payment failed for good, cancelled), and
// renewal invoices to add X posts to.
export async function handleStripeEvent(deps: BillingDeps, event: StripeEvent) {
  if (event.type === "invoice.created") {
    const result = await addXUsageToInvoice(deps, event.data.object as { id: string; customer: string; status?: string; billing_reason?: string });
    return { handled: true, ...result };
  }
  if (!event.type.startsWith("customer.subscription.")) return { handled: false };
  const subscription = event.data.object as { id: string; status: string; customer: string; metadata?: { workspace_id?: string }; items?: { data?: { quantity?: number }[] } };
  const workspaceId = subscription.metadata?.workspace_id;
  if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) return { handled: false };
  const status = event.type === "customer.subscription.deleted" ? "canceled" : subscription.status;
  await recordSubscription(deps.sql, workspaceId, { ...subscription, status });
  return { handled: true };
}
