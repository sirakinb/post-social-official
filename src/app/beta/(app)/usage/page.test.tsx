import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BetaUsagePage from "./page";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "token" }) }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/insforge/server", () => ({
  currentUser: async () => ({ id: "u1" }),
  insforgeServerClient: async () => ({ database: { from: () => ({ select: () => ({ eq: async () => ({ data: [{ workspace_id: "w1", workspaces: { name: "Ada", slug: "ada" } }] }) }) }) } }),
}));

const limit = (used: number, max: number) => ({ used, limit: max, unit: "count", percent: (used / max) * 100 });
const report = (plan: string, accountsMax: number) => ({
  period: { name: "This month", start: "2026-10-01", end: "2026-10-31" },
  plan: { name: plan, limits: { posts_per_month: limit(0, 3000), api_calls_per_day: limit(0, 5000), media_storage_bytes: limit(0, 5368709120), connected_accounts: limit(0, accountsMax) } },
  totals: { posts_published: 0, publishes_failed: 0, posts_created: 1, posts_created_by_ai: 0, api_calls: 0 },
  by_account: [],
  by_connection: [],
  daily: [],
});

beforeEach(() => vi.stubEnv("API_BASE_URL", "https://api.test"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("BetaUsagePage", () => {
  it("shows accounts as connected with the first 2 free, and keeps the jargon in a footnote", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(report("Free", 2)))));
    render(await BetaUsagePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Free plan")).toBeInTheDocument();
    expect(screen.getByText("connected · first 2 free")).toBeInTheDocument();
    expect(screen.queryByText("of 2")).toBeNull();
    expect(screen.getByText("Times are in UTC. Your AI apps can read these numbers too, with the get_usage tool.")).toBeInTheDocument();
  });

  it("keeps the cap for unbilled Tester workspaces", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(report("Tester", 50)))));
    render(await BetaUsagePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("of 50")).toBeInTheDocument();
  });
});
