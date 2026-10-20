import { render, screen } from "@testing-library/react";
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
  estimate: { monthly_total: 0, credit: 10, bands: [{ units: 2, perAccount: 5, amount: 10 }] },
  x: { spent: 0.42, posts: 21, monthly_cap: 1, set_cap: 10, price_per_post: 0.02, price_per_link_post: 0.25, free_monthly: 1 },
  can_manage: true,
  available: true,
};

beforeEach(() => {
  server.calls = [];
});

describe("BillingPage", () => {
  it("offers a card to Free workspaces", async () => {
    server.status = base;
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Add a card" })).toBeInTheDocument();
    expect(screen.getAllByText("Free")).toHaveLength(2);
    expect(screen.getByLabelText("Monthly X cap in dollars")).toHaveValue(10);
    expect(screen.getByText(/2¢ a post, 25¢ with a link/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "X spend this month" })).toHaveAttribute("aria-valuenow", "42");
  });

  it("warns near the X cap", async () => {
    server.status = { ...base, x: { ...base.x, spent: 0.9 } };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/Over 80% of this month's X cap/)).toHaveTextContent("Add a card to go past the free $1.");
  });

  it("confirms a checkout on return and shows Manage billing", async () => {
    server.status = { ...base, plan: { id: "paid", name: "Paid", comped: false }, connected_accounts: 12, subscription: { status: "active" }, estimate: { monthly_total: 45, credit: 10, bands: [{ units: 10, perAccount: 5, amount: 50 }, { units: 2, perAccount: 2.5, amount: 5 }] } };
    render(await BillingPage({ searchParams: Promise.resolve({ checkout: "cs_test_123" }) }));
    expect(server.calls[0]).toEqual(["billing_confirm", { workspace_id: "w1", session_id: "cs_test_123" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Card added");
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();
    expect(screen.getByText("$45 a month")).toBeInTheDocument();
    expect(screen.getByText(/10 accounts × \$5 · 2 accounts × \$2.50 · \$10 monthly credit/)).toBeInTheDocument();
  });

  it("lets only owners and admins change billing", async () => {
    server.status = { ...base, can_manage: false };
    render(await BillingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
    expect(screen.getByText("Only owners and admins can change billing.")).toBeInTheDocument();
  });
});
