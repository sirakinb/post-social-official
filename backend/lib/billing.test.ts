import { describe, expect, it } from "vitest";
import type { Sql } from "./access";
import { flushReports, setErrorReporter } from "./telemetry";
import { accountLimitMessage, addXUsageToInvoice, billingStatus, confirmCheckout, formEncode, handleStripeEvent, setXCap, startCheckout, syncAccountQuantity, verifyStripeSignature, type Stripe } from "./billing";

const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const person = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Ada", entryPoint: "ui" as const };

type State = { plan_id: string; plan_name: string; connected: number; stripe_customer_id?: string | null; stripe_subscription_id?: string | null; subscription_status?: string | null; billed_quantity?: number | null; x_monthly_cap_cents?: number };

// A database that answers the few queries billing makes, and records the rest.
function fakeSql(state: State, role = "owner") {
  const writes: Array<{ query: string; params: unknown[] }> = [];
  const sql = (async (query: string, params: unknown[] = []) => {
    if (query.includes("FROM public.workspace_members m")) return [{ role, actor_id: "actor-1" }];
    if (query.includes("FROM public.plans p")) return [state];
    writes.push({ query, params });
    return [];
  }) as Sql;
  return { sql, writes };
}

function fakeStripe(responses: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; path: string; params?: Record<string, unknown> }> = [];
  const stripe: Stripe = {
    async request(method, path, params) {
      calls.push({ method, path, params });
      const key = Object.keys(responses).find((k) => `${method} ${path}`.startsWith(k));
      return (key ? responses[key] : {}) as never;
    },
  };
  return { stripe, calls };
}

describe("formEncode", () => {
  it("encodes nested objects and arrays the way Stripe expects", () => {
    const body = formEncode({ mode: "subscription", line_items: [{ price: "p1", quantity: 3 }], metadata: { workspace_id: "w" }, skip: undefined, expand: ["subscription"] });
    expect([...body]).toEqual([
      ["mode", "subscription"],
      ["line_items[0][price]", "p1"],
      ["line_items[0][quantity]", "3"],
      ["metadata[workspace_id]", "w"],
      ["expand[0]", "subscription"],
    ]);
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  async function sign(body: string, t: number) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
    return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  it("accepts Stripe's signature and refuses anything else", async () => {
    const now = 1_800_000_000_000;
    const t = now / 1000;
    const body = '{"type":"customer.subscription.updated"}';
    const v1 = await sign(body, t);
    await expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, now)).resolves.toBe(true);
    await expect(verifyStripeSignature(`${body} `, `t=${t},v1=${v1}`, secret, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(body, `t=${t},v1=${"0".repeat(64)}`, secret, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(body, null, secret, now)).resolves.toBe(false);
  });

  it("refuses an old signature (a replay)", async () => {
    const t = 1_800_000_000;
    const body = "{}";
    await expect(verifyStripeSignature(body, `t=${t},v1=${await sign(body, t)}`, secret, (t + 301) * 1000)).resolves.toBe(false);
  });
});

describe("accountLimitMessage", () => {
  it("points Free workspaces to the Billing page", () => {
    const message = accountLimitMessage(new Error("Your Free plan allows 2 connected accounts. Disconnect one first."), "https://www.postsocial.xyz");
    expect(message).toContain("first 2 accounts are free");
    expect(message).toContain("https://www.postsocial.xyz/beta/billing");
    expect(accountLimitMessage(new Error("Your Free plan allows 2 connected accounts."))).not.toContain("(");
  });
  it("keeps other plans' wording and ignores unrelated errors", () => {
    expect(accountLimitMessage(new Error("Your Tester plan allows 50 connected accounts."), "x")).toContain("Tester plan allows 50");
    expect(accountLimitMessage(new Error("connection reset"), "x")).toBeNull();
  });
});

describe("billingStatus", () => {
  it("shows the estimate with the monthly credit", async () => {
    const { sql } = fakeSql({ plan_id: "paid", plan_name: "Paid", connected: 12, stripe_subscription_id: "sub_1", subscription_status: "active", billed_quantity: 12, x_monthly_cap_cents: 2500 });
    const status = await billingStatus({ sql, stripe: null, webAppUrl: "" }, person, { workspace_id: WORKSPACE });
    expect(status.estimate).toEqual({ monthly_total: 45, credit: 10, bands: [expect.objectContaining({ units: 10, perAccount: 5 }), expect.objectContaining({ units: 2, perAccount: 2.5 })] });
    expect(status.x).toMatchObject({ monthly_cap: 25, set_cap: 25, spent: 0 });
    expect(status.can_manage).toBe(true);
    expect(status.available).toBe(false);
  });

  it("has no estimate for comped (tester) workspaces", async () => {
    const { sql } = fakeSql({ plan_id: "tester", plan_name: "Tester", connected: 30 });
    const status = await billingStatus({ sql, stripe: null, webAppUrl: "" }, person, { workspace_id: WORKSPACE });
    expect(status.plan.comped).toBe(true);
    expect(status.estimate).toBeNull();
    expect(status.x.monthly_cap).toBeNull();
  });

  it("caps X at the free $1 without a card", async () => {
    const { sql } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 2, x_monthly_cap_cents: 1000 });
    const status = await billingStatus({ sql, stripe: null, webAppUrl: "" }, person, { workspace_id: WORKSPACE });
    expect(status.x).toMatchObject({ monthly_cap: 1, set_cap: 10 });
  });
});

describe("startCheckout", () => {
  it("opens Stripe Checkout for this workspace at its account count", async () => {
    const { sql } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 2 });
    const { stripe, calls } = fakeStripe({ "GET /v1/prices": { data: [{ id: "price_accounts" }] }, "POST /v1/checkout/sessions": { url: "https://checkout.stripe.com/c/pay/cs_test" } });
    const result = await startCheckout({ sql, stripe, webAppUrl: "https://www.postsocial.xyz" }, person, { workspace_id: WORKSPACE });
    expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_test");
    const session = calls.find((c) => c.path === "/v1/checkout/sessions")!.params!;
    expect(session).toMatchObject({ mode: "subscription", client_reference_id: WORKSPACE, metadata: { workspace_id: WORKSPACE }, subscription_data: { metadata: { workspace_id: WORKSPACE } } });
    expect(session.line_items).toEqual([{ price: "price_accounts", quantity: 2 }]);
    expect(session.success_url).toBe("https://www.postsocial.xyz/beta/billing?checkout={CHECKOUT_SESSION_ID}");
  });

  it("passes DataFast's visitor and session ids on in the checkout's metadata", async () => {
    const { sql } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 2 });
    const { stripe, calls } = fakeStripe({ "GET /v1/prices": { data: [{ id: "price_accounts" }] }, "POST /v1/checkout/sessions": { url: "https://checkout.stripe.com/c/pay/cs_test" } });
    await startCheckout({ sql, stripe, webAppUrl: "" }, person, { workspace_id: WORKSPACE, datafast_visitor_id: "df_visitor-123", datafast_session_id: "df_session.456" });
    expect(calls.find((c) => c.path === "/v1/checkout/sessions")!.params!.metadata).toEqual({ workspace_id: WORKSPACE, datafast_visitor_id: "df_visitor-123", datafast_session_id: "df_session.456" });
  });

  it("leaves out DataFast ids that are missing or don't look like ids", async () => {
    const { sql } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 2 });
    const { stripe, calls } = fakeStripe({ "GET /v1/prices": { data: [{ id: "price_accounts" }] }, "POST /v1/checkout/sessions": { url: "https://checkout.stripe.com/c/pay/cs_test" } });
    await startCheckout({ sql, stripe, webAppUrl: "" }, person, { workspace_id: WORKSPACE, datafast_visitor_id: "x".repeat(101), datafast_session_id: "a b<script>" });
    expect(calls.find((c) => c.path === "/v1/checkout/sessions")!.params!.metadata).toEqual({ workspace_id: WORKSPACE });
  });

  it("sends people back to the copy of the app they came from, if it's allowed", async () => {
    const run = async (origin: string) => {
      const { stripe, calls } = fakeStripe({ "GET /v1/prices": { data: [{ id: "price_accounts" }] } });
      await startCheckout({ sql: fakeSql({ plan_id: "free", plan_name: "Free", connected: 1 }).sql, stripe, webAppUrl: "https://www.postsocial.xyz", allowedOrigins: ["https://post-social-*-app-build-26.vercel.app"] }, person, { workspace_id: WORKSPACE, return_origin: origin });
      return calls.find((c) => c.path === "/v1/checkout/sessions")!.params!.cancel_url;
    };
    expect(await run("https://post-social-git-x-app-build-26.vercel.app")).toBe("https://post-social-git-x-app-build-26.vercel.app/beta/billing");
    expect(await run("https://evil.example")).toBe("https://www.postsocial.xyz/beta/billing");
  });

  it("is only for owners and admins", async () => {
    const { sql } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 2 }, "member");
    await expect(startCheckout({ sql, stripe: fakeStripe().stripe, webAppUrl: "" }, person, { workspace_id: WORKSPACE })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses comped workspaces and ones already paying", async () => {
    const stripe = fakeStripe().stripe;
    await expect(startCheckout({ sql: fakeSql({ plan_id: "tester", plan_name: "Tester", connected: 2 }).sql, stripe, webAppUrl: "" }, person, { workspace_id: WORKSPACE })).rejects.toMatchObject({ status: 409 });
    const paying = fakeSql({ plan_id: "paid", plan_name: "Paid", connected: 4, stripe_subscription_id: "sub_1", subscription_status: "active" }).sql;
    await expect(startCheckout({ sql: paying, stripe, webAppUrl: "" }, person, { workspace_id: WORKSPACE })).rejects.toMatchObject({ status: 409 });
  });
});

describe("confirmCheckout", () => {
  it("turns on Paid for a completed checkout of this workspace", async () => {
    const { sql, writes } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 2 });
    const { stripe } = fakeStripe({ "GET /v1/checkout/sessions/": { client_reference_id: WORKSPACE, status: "complete", subscription: { id: "sub_1", status: "active", customer: "cus_1", items: { data: [{ quantity: 2 }] } } } });
    await expect(confirmCheckout({ sql, stripe, webAppUrl: "" }, person, { workspace_id: WORKSPACE, session_id: "cs_test_abcdefghijkl" })).resolves.toEqual({ paid: true });
    expect(writes[0].params).toEqual([WORKSPACE, "cus_1", "sub_1", "active", 2, true]);
  });

  it("refuses another workspace's checkout and malformed ids", async () => {
    const { sql } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 2 });
    const { stripe } = fakeStripe({ "GET /v1/checkout/sessions/": { client_reference_id: "someone-else", status: "complete", subscription: null } });
    await expect(confirmCheckout({ sql, stripe, webAppUrl: "" }, person, { workspace_id: WORKSPACE, session_id: "cs_test_abcdefghijkl" })).rejects.toMatchObject({ status: 404 });
    await expect(confirmCheckout({ sql, stripe, webAppUrl: "" }, person, { workspace_id: WORKSPACE, session_id: "../../v1/customers" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("syncAccountQuantity", () => {
  it("updates Stripe's quantity with proration when accounts changed", async () => {
    const { sql, writes } = fakeSql({ plan_id: "paid", plan_name: "Paid", connected: 5, stripe_subscription_id: "sub_1", subscription_status: "active", billed_quantity: 4 });
    const { stripe, calls } = fakeStripe({ "GET /v1/subscriptions/sub_1": { items: { data: [{ id: "si_1" }] } } });
    await expect(syncAccountQuantity({ sql, stripe, webAppUrl: "" }, WORKSPACE)).resolves.toBe(5);
    expect(calls.at(-1)).toEqual({ method: "POST", path: "/v1/subscription_items/si_1", params: { quantity: 5, proration_behavior: "create_prorations" } });
    expect(writes[0].params).toEqual([WORKSPACE, 5]);
  });

  it("does nothing when the count matches or there is no subscription", async () => {
    const { stripe, calls } = fakeStripe();
    await syncAccountQuantity({ sql: fakeSql({ plan_id: "paid", plan_name: "Paid", connected: 4, stripe_subscription_id: "sub_1", subscription_status: "active", billed_quantity: 4 }).sql, stripe, webAppUrl: "" }, WORKSPACE);
    await syncAccountQuantity({ sql: fakeSql({ plan_id: "free", plan_name: "Free", connected: 2 }).sql, stripe, webAppUrl: "" }, WORKSPACE);
    expect(calls).toEqual([]);
  });
});

describe("setXCap", () => {
  it("saves the cap in cents and checks the range", async () => {
    const { sql, writes } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 1 });
    await expect(setXCap({ sql, stripe: null, webAppUrl: "" }, person, { workspace_id: WORKSPACE, monthly_cap: "12.5" })).resolves.toEqual({ monthly_cap: 12.5 });
    expect(writes[0].params).toEqual([WORKSPACE, 1250]);
    await expect(setXCap({ sql, stripe: null, webAppUrl: "" }, person, { workspace_id: WORKSPACE, monthly_cap: "-1" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("handleStripeEvent", () => {
  it("records subscription changes and treats deletion as cancelled", async () => {
    const { sql, writes } = fakeSql({ plan_id: "paid", plan_name: "Paid", connected: 3 });
    const event = { type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "active", customer: "cus_1", metadata: { workspace_id: WORKSPACE } } } };
    await expect(handleStripeEvent({ sql, stripe: null, webAppUrl: "" }, event)).resolves.toEqual({ handled: true });
    expect(writes[0].params).toEqual([WORKSPACE, "cus_1", "sub_1", "canceled", null, false]);
  });

  it("records a subscription_started event when a paid subscription is created", async () => {
    const sent: Array<{ event: string; properties: Record<string, unknown> }> = [];
    setErrorReporter({ captureException: async () => undefined, capture: async (event, properties) => void sent.push({ event, properties: properties ?? {} }) });
    const { sql } = fakeSql({ plan_id: "paid", plan_name: "Paid", connected: 3 });
    const created = (status: string) => ({ type: "customer.subscription.created", data: { object: { id: "sub_1", status, customer: "cus_1", metadata: { workspace_id: WORKSPACE }, items: { data: [{ quantity: 3 }] } } } });
    await handleStripeEvent({ sql, stripe: null, webAppUrl: "" }, created("active"));
    await handleStripeEvent({ sql, stripe: null, webAppUrl: "" }, created("incomplete"));
    await handleStripeEvent({ sql, stripe: null, webAppUrl: "" }, { type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active", customer: "cus_1", metadata: { workspace_id: WORKSPACE } } } });
    await flushReports();
    setErrorReporter(null);
    expect(sent).toEqual([{ event: "subscription_started", properties: { workspace_id: WORKSPACE, accounts: 3 } }]);
  });

  it("ignores other events and subscriptions without a workspace", async () => {
    const { sql, writes } = fakeSql({ plan_id: "free", plan_name: "Free", connected: 0 });
    await handleStripeEvent({ sql, stripe: null, webAppUrl: "" }, { type: "invoice.paid", data: { object: {} } });
    await handleStripeEvent({ sql, stripe: null, webAppUrl: "" }, { type: "customer.subscription.updated", data: { object: { id: "s", status: "active", customer: "c" } } });
    expect(writes).toEqual([]);
  });
});

describe("addXUsageToInvoice", () => {
  const invoice = { id: "in_1", customer: "cus_1", status: "draft", billing_reason: "subscription_cycle" };
  function db(months: Array<{ month: string; posts: number; link_posts: number; total_cents: number; billed_cents: number }>, alreadySaved = false) {
    const queries: Array<{ query: string; params: unknown[] }> = [];
    const sql = (async (query: string, params: unknown[] = []) => {
      queries.push({ query, params });
      if (query.includes("FROM public.x_charges c")) return months.map((m) => ({ workspace_id: WORKSPACE, ...m }));
      if (query.includes("INSERT INTO public.x_invoice_lines")) return alreadySaved ? [] : [{ month: params[2] }];
      return [];
    }) as Sql;
    return { sql, queries };
  }

  it("adds each month's X posts past the free $1, minus what was billed already", async () => {
    const { sql } = db([
      { month: "2026-09-01", posts: 80, link_posts: 2, total_cents: 206, billed_cents: 50 },
      { month: "2026-10-01", posts: 30, link_posts: 0, total_cents: 60, billed_cents: 0 },
    ]);
    const { stripe, calls } = fakeStripe();
    await expect(addXUsageToInvoice({ sql, stripe, webAppUrl: "" }, invoice)).resolves.toEqual({ added: 56 });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toMatchObject({ customer: "cus_1", invoice: "in_1", currency: "usd", amount: 56, description: "X posts, September 2026: 80 posts (2 with a link), first $1 free" });
  });

  it("never adds a line twice, and leaves other invoices alone", async () => {
    const { stripe, calls } = fakeStripe();
    await addXUsageToInvoice({ sql: db([{ month: "2026-10-01", posts: 100, link_posts: 0, total_cents: 200, billed_cents: 0 }], true).sql, stripe, webAppUrl: "" }, invoice);
    await addXUsageToInvoice({ sql: db([{ month: "2026-10-01", posts: 100, link_posts: 0, total_cents: 200, billed_cents: 0 }]).sql, stripe, webAppUrl: "" }, { ...invoice, status: "open" });
    await addXUsageToInvoice({ sql: db([{ month: "2026-10-01", posts: 100, link_posts: 0, total_cents: 200, billed_cents: 0 }]).sql, stripe, webAppUrl: "" }, { ...invoice, billing_reason: "subscription_create" });
    expect(calls).toEqual([]);
  });

  it("forgets the saved line when Stripe fails, so the retry adds it", async () => {
    const { sql, queries } = db([{ month: "2026-10-01", posts: 100, link_posts: 0, total_cents: 200, billed_cents: 0 }]);
    const stripe: Stripe = { request: async () => { throw new Error("Stripe down"); } };
    await expect(addXUsageToInvoice({ sql, stripe, webAppUrl: "" }, invoice)).rejects.toThrow("Stripe down");
    expect(queries.at(-1)!.query).toContain("DELETE FROM public.x_invoice_lines");
  });
});
