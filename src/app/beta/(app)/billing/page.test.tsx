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
  it("shows the upcoming invoice and offers a card to Free workspaces", async () => {
    server.status = base;
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    const upcoming = within(screen.getByRole("region", { name: "Upcoming invoice" }));
    expect(upcoming.getByText(/Upcoming invoice · Oct 1 to Oct 31/)).toBeInTheDocument();
    expect(upcoming.getByText("No card on file. 2 accounts are free.")).toBeInTheDocument();
    expect(upcoming.getByRole("button", { name: "Add a card" })).toBeInTheDocument();
    expect(screen.getByLabelText("X monthly cap in dollars")).toHaveValue(10);
    expect(screen.getByText(/\$0.42 of \$1.00 used/)).toBeInTheDocument();
    expect(screen.getByText("No invoices yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch to Free" })).toBeNull();
  });

  it("warns near the X cap", async () => {
    server.status = { ...base, x: { ...base.x, spent: 0.9 } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Close to your cap.")).toBeInTheDocument();
  });

  it("confirms a checkout on return and shows the card, details and invoices", async () => {
    server.status = paid;
    render(await BillingPage({ searchParams: Promise.resolve({ checkout: "cs_test_123" }) }));
    expect(server.calls[0]).toEqual(["billing_confirm", { workspace_id: "w1", session_id: "cs_test_123" }]);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Card added");
    expect(screen.getAllByText("$45.42")).toHaveLength(2);
    expect(screen.getByText("Charged on Oct 31, 2026.")).toBeInTheDocument();
    expect(screen.getByText("Visa •••• 4242")).toBeInTheDocument();
    expect(screen.getByText("Expires 04/2030")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to Free" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download invoice PS-0001/ })).toHaveAttribute("href", "https://pay.stripe.com/in_1.pdf");
  });

  it("keeps the wording quiet", async () => {
    server.status = paid;
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(document.body.textContent).not.toMatch(/charges us|by the day|prorat/i);
  });

  it("lets only owners and admins change billing", async () => {
    server.status = { ...base, can_manage: false };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
    expect(screen.queryByLabelText("X monthly cap in dollars")).toBeNull();
    expect(screen.getByText("Only owners and admins can change billing.")).toBeInTheDocument();
  });
});
