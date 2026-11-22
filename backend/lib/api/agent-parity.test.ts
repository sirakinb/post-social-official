// Tools that give AI agents what people can do in the app (PEN-39): whole-account stats,
// disconnecting an account, billing and the X limit, and an automation's posts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCaller, Sql } from "../access";

const mocks = vi.hoisted(() => ({
  analyticsDashboard: vi.fn(),
  disconnectAccount: vi.fn(),
  billingStatus: vi.fn(),
  setXCap: vi.fn(),
  automationPosts: vi.fn(),
}));
vi.mock("../analytics-dashboard", async (actual) => ({ ...(await actual<object>()), analyticsDashboard: mocks.analyticsDashboard }));
vi.mock("../connections/service", async (actual) => ({ ...(await actual<object>()), disconnectAccount: mocks.disconnectAccount }));
vi.mock("../billing", async (actual) => ({ ...(await actual<object>()), billingStatus: mocks.billingStatus, setXCap: mocks.setXCap }));
vi.mock("../inbox/automations", async (actual) => ({ ...(await actual<object>()), automationPosts: mocks.automationPosts }));
vi.mock("../access", async (actual) => ({ ...(await actual<object>()), membership: vi.fn(async () => ({ role: "owner", actor_id: "a" })) }));

const { availableOperations, operations, runOperation } = await import("./operations");
const { matchRoute } = await import("./rest");

const WORKSPACE = "00000000-0000-4000-8000-000000000002";
const ACCOUNT = "00000000-0000-4000-8000-0000000000aa";
const caller: AgentCaller = {
  kind: "key",
  credentialId: "00000000-0000-4000-8000-000000000001",
  workspaceId: WORKSPACE,
  actorId: "00000000-0000-4000-8000-000000000003",
  mode: "live",
  displayName: "Claude",
  entryPoint: "mcp",
};
type Deps = Parameters<typeof runOperation>[1];
const deps = (sql: Sql, extra: Partial<Deps> = {}): Deps => ({ sql, r2: {} as never, newId: () => "id", webAppUrl: "https://www.postsocial.xyz", analyticsPlatforms: ["instagram"], inbox: { all: true, workspaces: [] }, ...extra });
const op = (name: string) => operations.find((o) => o.name === name)!;
const noSql = (async () => []) as unknown as Sql;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("agent tools for app features", () => {
  it("offers each new tool where its feature is switched on, with its own route", () => {
    const names = availableOperations(deps(noSql)).map((o) => o.name);
    for (const name of ["get_analytics_overview", "disconnect_account", "get_billing", "set_x_monthly_limit", "list_automation_posts"]) expect(names, name).toContain(name);
    const off = availableOperations({ analyticsPlatforms: [] }).map((o) => o.name);
    expect(off).not.toContain("get_analytics_overview");
    expect(off).not.toContain("list_automation_posts");
    expect(off).toContain("disconnect_account");
    const route = (method: string, path: string) => {
      const hit = matchRoute(method, path);
      return hit && "operation" in hit ? hit.operation.name : null;
    };
    expect(route("GET", "/v1/analytics/overview")).toBe("get_analytics_overview");
    expect(route("DELETE", `/v1/accounts/${ACCOUNT}`)).toBe("disconnect_account");
    expect(route("POST", "/v1/accounts/connect-link")).toBe("request_connect_link");
    expect(route("GET", `/v1/accounts/${ACCOUNT}/automation-posts`)).toBe("list_automation_posts");
    expect(op("disconnect_account").destructive).toBe(true);
  });

  it("gives the overview without the long post list, for this workspace only", async () => {
    mocks.analyticsDashboard.mockResolvedValue({ period: "last_7_days", summary: { posts: 2 }, accounts: [{ id: ACCOUNT, insights: { views: 10 }, audience: null, outside_posts: 1 }], posts: [{}, {}] });
    const result = (await runOperation(op("get_analytics_overview"), deps(noSql), caller, { period: "last_7_days" })) as Record<string, unknown>;
    expect(result).not.toHaveProperty("posts");
    expect(result).toMatchObject({ summary: { posts: 2 }, accounts: [{ insights: { views: 10 }, outside_posts: 1 }] });
    expect(mocks.analyticsDashboard).toHaveBeenCalledWith(noSql, caller, ["instagram"], { period: "last_7_days", workspace_id: WORKSPACE });
  });

  it("disconnects only an account in the caller's workspace, and keeps billing in step", async () => {
    const empty = vi.fn(async () => []) as unknown as Sql;
    await expect(runOperation(op("disconnect_account"), deps(empty, { setting: () => "" }), caller, { account_id: ACCOUNT })).rejects.toMatchObject({ status: 404 });
    expect(empty).toHaveBeenCalledWith(expect.stringContaining("workspace_id = $2"), [ACCOUNT, WORKSPACE]);
    expect(mocks.disconnectAccount).not.toHaveBeenCalled();

    await expect(runOperation(op("disconnect_account"), deps(noSql), caller, { account_id: ACCOUNT })).rejects.toMatchObject({ status: 503 });
    await expect(runOperation(op("disconnect_account"), deps(noSql, { setting: () => "" }), { ...caller, mode: "test" }, { account_id: ACCOUNT })).rejects.toMatchObject({ status: 403 });

    const found = vi.fn(async () => [{ id: ACCOUNT }]) as unknown as Sql;
    mocks.disconnectAccount.mockResolvedValue({ account_id: ACCOUNT, status: "disconnected" });
    const setting = () => "";
    await expect(runOperation(op("disconnect_account"), deps(found, { setting }), caller, { account_id: ACCOUNT })).resolves.toMatchObject({ status: "disconnected" });
    const [connectionDeps, passedCaller, input] = mocks.disconnectAccount.mock.calls[0];
    expect(connectionDeps).toMatchObject({ sql: found, setting });
    expect(typeof connectionDeps.afterAccountsChanged).toBe("function");
    expect(passedCaller).toBe(caller);
    expect(input).toEqual({ account_id: ACCOUNT });
  });

  it("reads billing and sets the X limit for the caller's workspace", async () => {
    mocks.billingStatus.mockResolvedValue({ plan: { id: "free" }, x: { monthly_cap: 0 } });
    await expect(runOperation(op("get_billing"), deps(noSql), caller, {})).resolves.toMatchObject({ plan: { id: "free" } });
    expect(mocks.billingStatus.mock.calls[0][2]).toEqual({ workspace_id: WORKSPACE });

    mocks.setXCap.mockResolvedValue({ monthly_cap: 12.5 });
    await expect(runOperation(op("set_x_monthly_limit"), deps(noSql), caller, { monthly_limit: 12.5 })).resolves.toEqual({ monthly_limit: 12.5 });
    expect(mocks.setXCap.mock.calls[0][2]).toEqual({ workspace_id: WORKSPACE, monthly_cap: 12.5 });
    await expect(runOperation(op("set_x_monthly_limit"), deps(noSql), caller, {})).rejects.toMatchObject({ status: 400 });
    await expect(runOperation(op("set_x_monthly_limit"), deps(noSql), { ...caller, mode: "test" }, { monthly_limit: 5 })).rejects.toMatchObject({ status: 403 });
  });

  it("lists an account's posts for an automation in the caller's workspace", async () => {
    mocks.automationPosts.mockResolvedValue({ posts: [{ platform_post_id: "1", outside: true }] });
    await expect(runOperation(op("list_automation_posts"), deps(noSql), caller, { account_id: ACCOUNT })).resolves.toEqual({ posts: [{ platform_post_id: "1", outside: true }] });
    expect(mocks.automationPosts.mock.calls[0][2]).toEqual({ account_id: ACCOUNT, workspace_id: WORKSPACE });
  });

  it("includes posts made outside Post Social in the stats list unless asked not to", async () => {
    const sql = vi.fn(async () => []) as unknown as Sql;
    await runOperation(op("list_analytics"), deps(sql), caller, {});
    const listCall = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([text]) => String(text).includes("account_posts"));
    expect(listCall?.[1]?.[4]).toBe(true);
    (sql as unknown as ReturnType<typeof vi.fn>).mockClear();
    await runOperation(op("list_analytics"), deps(sql), caller, { include_outside: false });
    const withoutCall = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([text]) => String(text).includes("account_posts"));
    expect(withoutCall?.[1]?.[4]).toBe(false);
  });
});

