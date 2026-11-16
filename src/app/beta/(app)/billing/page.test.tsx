import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingPage, { type BillingStatus } from "./page";

const server = vi.hoisted(() => ({ status: null as unknown, calls: [] as Array<[string, Record<string, unknown>]> }));
vi.mock("@/lib/beta/workspace", () => ({
  loadViewer: async () => ({ workspace: { id: "w1", name: "Ada's workspace", slug: "ada", role: "owner" } }),
  callServer: async (action: string, body: Record<string, unknown>) => {
    server.calls.push([action, body]);
    return action === "billing_status" ? server.status : { paid: true };
  },
  callServerResult: async (action: string, body: Record<string, unknown>) => {
    server.calls.push([action, body]);
    return server.status ? { data: server.status, error: null } : { data: null, error: "Something broke on the server." };
  },
}));
vi.mock("./actions", () => ({ addCard: async () => {}, manageBilling: async () => {}, saveXCap: async () => {} }));
const jar = vi.hoisted(() => ({ flash: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "ps_flash" && jar.flash ? { value: jar.flash } : undefined) }) }));

const base: BillingStatus = {
  plan: { id: "free", name: "Free", comped: false },
  connected_accounts: 2,
  free_accounts: 2,
  subscription: null,
  x: { spent: 0, posts: 0, monthly_cap: 0, set_cap: 10, free_monthly: 0 },
  can_manage: true,
  available: true,
  upcoming: { total: 0, period_start: "2026-10-01T00:00:00Z", period_end: "2026-10-31T00:00:00Z", lines: [{ label: "Connected accounts", detail: "2 accounts, 2 free", amount: 0 }] },
  card: null,
  details: null,
  invoices: [],
};

const paid: BillingStatus = {
  ...base,
  plan: { id: "paid", name: "Paid", comped: false },
  paying: true,
  connected_accounts: 12,
  subscription: { status: "active" },
  x: { spent: 0.42, posts: 21, monthly_cap: 10, set_cap: 10, free_monthly: 0 },
  upcoming: {
    total: 45.42,
    period_start: "2026-10-01T00:00:00Z",
    period_end: "2026-10-31T00:00:00Z",
    lines: [
      { label: "Connected accounts", detail: "12 accounts", amount: 45 },
      { label: "X posts", detail: "21 posts", amount: 0.42 },
    ],
  },
  card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 },
  details: { email: "ada@example.com", name: "Ada", address: null },
  invoices: [{ id: "in_1", number: "PS-0001", date: "2026-09-30T00:00:00Z", total: 12.5, status: "paid", pdf: "https://pay.stripe.com/in_1.pdf", url: null }],
};

beforeEach(() => {
  server.calls = [];
  jar.flash = undefined;
});

describe("BillingPage", () => {
  it("offers a $0 card to a Free workspace, for X and account 3, with no used-up X limit", async () => {
    server.status = base;
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    const month = within(screen.getByRole("region", { name: "Your month" }));
    expect(month.getByText("To pay")).toBeInTheDocument();
    expect(month.getByText("Your first 2 accounts are free. Add a card to post to X or to connect account 3 ($5 a month).")).toBeInTheDocument();
    expect(month.getByRole("button", { name: "Add a card · $0/mo" })).toBeInTheDocument();
    const rate = within(screen.getByRole("region", { name: "Your rate" }));
    expect(rate.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Accounts 1–2Free2 of yours", "Accounts 3–10$5/mo\u00a0", "Accounts 11–100$2.50/mo\u00a0", "Accounts 101+$1/mo\u00a0"]);
    const x = within(screen.getByRole("region", { name: "X spending" }));
    expect(x.getByText("Posting to X needs a card. X posts are 5¢ each (25¢ with a link), added to your monthly bill.")).toBeInTheDocument();
    expect(x.getByRole("button", { name: "Add a card" })).toBeInTheDocument();
    expect(screen.queryByText(/paused|until next month|^limit /)).toBeNull();
    expect(screen.queryByLabelText("X monthly limit in dollars")).toBeNull();
    expect(screen.getByText("Receipts show up here after your first charge.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel paid plan" })).toBeNull();
  });

  it("offers the card before any account is connected too (X can be the first one)", async () => {
    server.status = { ...base, connected_accounts: 0 };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Add a card · $0/mo" })).toBeInTheDocument();
  });

  it("shows the real monthly price when a Free workspace already has more than 2 accounts", async () => {
    server.status = { ...base, connected_accounts: 6, estimate: { monthly_total: 20 } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("You have 6 accounts: $20.00 a month once you add a card.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a card · $20.00/mo" })).toBeInTheDocument();
  });

  it("says when a cancelled plan ends instead of a next charge, and offers to keep it", async () => {
    server.status = { ...paid, ends_at: "2026-11-30T00:00:00Z", upcoming: null };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/Your paid plan ends on November 30\. No more charges after that/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep paid plan" })).toBeInTheDocument();
    expect(screen.queryByText("Next charge")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel paid plan" })).toBeNull();
  });

  it("asks for a new card when a payment didn't go through", async () => {
    server.status = { ...paid, subscription: { status: "past_due" } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Your last payment didn't go through.");
    expect(screen.getByRole("button", { name: "Update card" })).toBeInTheDocument();
  });

  it("says the plan stopped after a failed payment and offers the card again", async () => {
    server.status = { ...paid, paying: false, plan: { id: "free", name: "Free", comped: false }, subscription: { status: "unpaid" }, connected_accounts: 2 };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("A payment failed, so your paid plan stopped.");
    expect(screen.getByRole("button", { name: "Add a card · $0/mo" })).toBeInTheDocument();
    expect(screen.queryByLabelText("X monthly limit in dollars")).toBeNull();
  });

  it("says X is off when a paying workspace sets its X limit to $0", async () => {
    server.status = { ...paid, x: { ...paid.x, monthly_cap: 0, set_cap: 0 } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("X posting is off: your monthly X limit is $0. Raise it to post to X.")).toBeInTheDocument();
  });

  it("shows a Tester workspace its account count against the plan's limit", async () => {
    server.status = { ...base, plan: { id: "tester", name: "Tester", comped: true, account_limit: 50 }, connected_accounts: 1, x: { ...base.x, posts: 3 } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("1 of 50 accounts connected · 3 X posts this month.")).toBeInTheDocument();
  });

  it("lets a paying workspace set its own X limit", async () => {
    server.status = paid;
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText("X monthly limit in dollars")).toBeInTheDocument();
  });

  it("warns near the X limit", async () => {
    server.status = { ...paid, x: { ...paid.x, spent: 9, monthly_cap: 10 } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Close to your X limit.")).toBeInTheDocument();
  });

  it("confirms a checkout on return and shows the next charge, card and receipts", async () => {
    server.status = paid;
    render(await BillingPage({ searchParams: Promise.resolve({ checkout: "cs_test_123" }) }));
    expect(server.calls[0]).toEqual(["billing_confirm", { workspace_id: "w1", session_id: "cs_test_123" }]);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("You're on the paid plan. Connect your next account");
    expect(screen.getByRole("link", { name: "Connect your next account" })).toHaveAttribute("href", "/beta/accounts#connect");
    expect(screen.getByText("$45.42")).toBeInTheDocument();
    expect(screen.getByText("On October 31.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Your rate" })).getAllByRole("listitem")[1]).toHaveTextContent("8 of yours");
    expect(screen.getByText(/Visa ending 4242/)).toBeInTheDocument();
    expect(screen.getByText("Receipts go to ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel paid plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Receipt for September 2026" })).toHaveAttribute("href", "https://pay.stripe.com/in_1.pdf");
  });

  it("keeps its own wording", async () => {
    server.status = paid;
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(document.body.textContent).not.toMatch(/charges us|by the day|prorat|upcoming invoice|cost controls|payment method|billing details|switch to free|in advance|so far/i);
  });

  it("shows a card saved in Stripe Link", async () => {
    server.status = { ...paid, card: null, link: { email: "ada@example.com" } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Link")).toBeInTheDocument();
    expect(screen.queryByText("No card yet.")).toBeNull();
  });

  it("says why Billing didn't load", async () => {
    server.status = null;
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Billing could not be loaded. Something broke on the server.");
  });

  it("lets only owners and admins change billing", async () => {
    server.status = { ...base, can_manage: false };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: /Add a card/ })).toBeNull();
    expect(screen.queryByLabelText("X monthly limit in dollars")).toBeNull();
    expect(screen.getByText("Ask a workspace owner or admin to add a card.")).toBeInTheDocument();
    expect(screen.getByText("Only owners and admins can change billing.")).toBeInTheDocument();
  });

  it("shows only its own wording for an error in the address, never the address's text", async () => {
    server.status = base;
    render(await BillingPage({ searchParams: Promise.resolve({ error: "Your card was declined. Call 555-0100 now." }) }));
    expect(screen.queryByText(/555-0100/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("maps a known error code to fixed wording, or to our server's message from the cookie", async () => {
    server.status = base;
    const { unmount } = render(await BillingPage({ searchParams: Promise.resolve({ error: "unreachable" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Post Social couldn't be reached.");
    unmount();
    jar.flash = "error:" + encodeURIComponent("Only owners and admins can add a card.");
    render(await BillingPage({ searchParams: Promise.resolve({ error: "billing_failed" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Only owners and admins can add a card.");
  });
});
