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

const base: BillingStatus = {
  plan: { id: "free", name: "Free", comped: false },
  connected_accounts: 2,
  free_accounts: 2,
  subscription: null,
  x: { spent: 0.42, posts: 21, monthly_cap: 1, set_cap: 10, free_monthly: 1 },
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
  connected_accounts: 12,
  subscription: { status: "active" },
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
});

describe("BillingPage", () => {
  it("shows the month and the rate ladder, and offers account 3 to Free workspaces", async () => {
    server.status = base;
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    const month = within(screen.getByRole("region", { name: "Your month" }));
    expect(month.getByText("To pay")).toBeInTheDocument();
    expect(month.getByText("Your first 2 accounts are free. Account 3 is $5 a month, charged when you add it.")).toBeInTheDocument();
    expect(month.getByRole("button", { name: "Add account 3 · $5/mo" })).toBeInTheDocument();
    const rate = within(screen.getByRole("region", { name: "Your rate" }));
    expect(rate.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Accounts 1–2Free2 of yours", "Accounts 3–10$5/mo\u00a0", "Accounts 11–100$2.50/mo\u00a0", "Accounts 101+$1/mo\u00a0"]);
    expect(rate.getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByLabelText("X monthly limit in dollars")).toHaveValue(10);
    expect(screen.getByText("Receipts show up here after your first charge.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel paid plan" })).toBeNull();
  });

  it("warns near the X limit", async () => {
    server.status = { ...base, x: { ...base.x, spent: 0.9 } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Close to your limit.")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Add account 3 · $5/mo" })).toBeNull();
    expect(screen.queryByLabelText("X monthly limit in dollars")).toBeNull();
    expect(screen.getByText("Only owners and admins can change billing.")).toBeInTheDocument();
  });
});
