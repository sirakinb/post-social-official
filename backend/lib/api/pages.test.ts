// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AgentCaller, Caller, Sql } from "../access";
import { accountsPage, appFrame, composerPage, inboxAccountsList, isPageRead, mediaByIds, myWorkspaces, pageActions } from "./pages";

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

  it("reads each page in one statement after the membership check, scoped to the workspace", async () => {
    for (const [read, answer] of [
      [accountsPage, { accounts: [{ id: "a" }], last_posted: [], profiles: [] }],
      [composerPage, { accounts: [], media: [{ id: "m" }], profiles: [], post: null, pending_media: null }],
    ] as const) {
      const { sql, calls } = database([answer]);
      expect(await read(sql, person, { workspace_id: WORKSPACE })).toEqual(answer);
      expect(calls).toHaveLength(2);
      expect(calls[1].params[0]).toBe(WORKSPACE);
      // Every table read is narrowed to the workspace.
      expect(calls[1].query.match(/FROM public\.\w+/g)!.length).toBeLessThanOrEqual(calls[1].query.match(/workspace_id = \$1|post_id = o\.id/g)!.length);
    }
    const inbox = database([{ id: "a", platform: "instagram" }]);
    expect(await inboxAccountsList(inbox.sql, person, { workspace_id: WORKSPACE })).toEqual({ accounts: [{ id: "a", platform: "instagram" }] });
  });

  it("refuses ids that aren't ids, and long lists, before reading anything", async () => {
    const { sql, calls } = database([]);
    await expect(composerPage(sql, person, { workspace_id: WORKSPACE, post_id: "x' OR '1'='1" })).rejects.toMatchObject({ status: 400 });
    await expect(composerPage(sql, person, { workspace_id: WORKSPACE, media_id: 12 })).rejects.toMatchObject({ status: 400 });
    await expect(mediaByIds(sql, person, { workspace_id: WORKSPACE, ids: "all" })).rejects.toMatchObject({ status: 400 });
    await expect(mediaByIds(sql, person, { workspace_id: WORKSPACE, ids: [WORKSPACE, "nope"] })).rejects.toMatchObject({ status: 400 });
    await expect(mediaByIds(sql, person, { workspace_id: WORKSPACE, ids: Array.from({ length: 61 }, () => WORKSPACE) })).rejects.toMatchObject({ status: 400 });
    // Only the membership checks ran.
    expect(calls.every((call) => call.query.includes("WITH member AS"))).toBe(true);
    expect(await mediaByIds(sql, person, { workspace_id: WORKSPACE, ids: [] })).toEqual({ media: [] });
  });

  it("answers 'not found' for every page read when the person isn't in the workspace, and refuses keys", async () => {
    for (const read of [accountsPage, composerPage, inboxAccountsList, mediaByIds]) {
      const { sql, calls } = database([{ accounts: ["secret"] }], false);
      await expect(read(sql, person, { workspace_id: WORKSPACE, ids: [] })).rejects.toMatchObject({ status: 404 });
      expect(calls).toHaveLength(1);
      await expect(read(sql, key, { workspace_id: WORKSPACE, ids: [] })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("names its actions, so the route can give reads their own allowance", () => {
    expect(Object.keys(pageActions).sort()).toEqual(["accounts_page", "app_frame", "composer_page", "inbox_accounts", "media_by_ids", "my_workspaces"]);
    expect(isPageRead("app_frame")).toBe(true);
    expect(isPageRead("create_key")).toBe(false);
    expect(isPageRead("toString")).toBe(false);
  });
});
