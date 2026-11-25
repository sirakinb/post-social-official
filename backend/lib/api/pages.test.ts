// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AgentCaller, Caller, Sql } from "../access";
import { appFrame, isPageRead, myWorkspaces, pageActions } from "./pages";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const person: Caller = { userId: "22222222-2222-4222-8222-222222222222", displayName: "Ada", entryPoint: "ui" };
const key: AgentCaller = { kind: "key", credentialId: "k", workspaceId: WORKSPACE, actorId: "a", mode: "live", displayName: "Key", entryPoint: "api" };

// Answers the membership check, then the page's own statement.
function database(answer: Record<string, unknown>[], member = true) {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const sql = vi.fn(async (query: string, params: unknown[]) => {
    calls.push({ query, params });
    if (query.includes("WITH member AS")) return member ? [{ role: "owner", actor_id: "actor" }] : [];
    return answer;
  }) as unknown as Sql;
  return { sql, calls };
}

describe("what the web app's pages read", () => {
  it("lists the person's own workspaces, asked for by their id and nothing they sent", async () => {
    const { sql, calls } = database([{ id: WORKSPACE, name: "Pentridge", slug: "pentridge", role: "owner" }]);
    expect(await myWorkspaces(sql, person)).toEqual({ workspaces: [{ id: WORKSPACE, name: "Pentridge", slug: "pentridge", role: "owner" }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([person.userId]);
    expect(calls[0].query).toMatch(/WHERE m\.user_id = \$1/);
  });

  it("gives the app frame: plan, this month's posts and the getting-started steps", async () => {
    const { sql, calls } = database([{ plan: { name: "Free", max_posts_per_month: 30 }, posts_published: "7", account: true, app: false, key: true, post: false }]);
    expect(await appFrame(sql, person, { workspace_id: WORKSPACE })).toEqual({ plan: { name: "Free", max_posts_per_month: 30 }, posts_published: 7, steps: { account: true, ai: true, post: false } });
    // One statement after the membership check, scoped to the workspace throughout.
    expect(calls).toHaveLength(2);
    expect(calls[1].params[0]).toBe(WORKSPACE);
    expect(calls[1].query.match(/workspace_id = \$1/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("copes with a workspace that has no plan and nothing yet", async () => {
    const { sql } = database([{ plan: null, posts_published: 0, account: false, app: false, key: false, post: false }]);
    expect(await appFrame(sql, person, { workspace_id: WORKSPACE })).toEqual({ plan: null, posts_published: 0, steps: { account: false, ai: false, post: false } });
  });

  it("answers 'not found' for a workspace the person isn't in, and reads nothing from it", async () => {
    const { sql, calls } = database([{ plan: { name: "Paid" } }], false);
    await expect(appFrame(sql, person, { workspace_id: WORKSPACE })).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(1);
  });

  it("refuses an id that isn't one before touching the database", async () => {
    const { sql, calls } = database([]);
    for (const bad of [undefined, "", "1 OR 1=1", `${WORKSPACE}'; DROP TABLE posts; --`]) await expect(appFrame(sql, person, { workspace_id: bad })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("is for people in the web app, not keys or signed-in apps", async () => {
    const { sql, calls } = database([]);
    await expect(myWorkspaces(sql, key)).rejects.toMatchObject({ status: 403 });
    await expect(appFrame(sql, key, { workspace_id: WORKSPACE })).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(0);
  });

  it("names its actions, so the route can give reads their own allowance", () => {
    expect(Object.keys(pageActions).sort()).toEqual(["app_frame", "my_workspaces"]);
    expect(isPageRead("app_frame")).toBe(true);
    expect(isPageRead("create_key")).toBe(false);
    expect(isPageRead("toString")).toBe(false);
  });
});
