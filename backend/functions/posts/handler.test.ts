// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../lib/access";
import { LIMITS } from "../../lib/rate-limit";
import { createPostsHandler } from "./handler";

vi.mock("../../lib/publishing/service", () => ({
  postActions: {
    validate: vi.fn(async () => ({ ok: true, problems: [] })),
    create: vi.fn(async () => ({ id: "p1", status: "draft" })),
  },
}));
vi.mock("../../lib/telemetry", () => ({ reportError: vi.fn() }));

// The counters table, in memory: the same answer take_rate_limit gives (0 = go ahead,
// otherwise seconds to wait), and a record of what was asked.
function counters(used: Record<string, number> = {}) {
  const asked: { key: string; limit: number; windowSeconds: number }[] = [];
  const sql = (async (query: string, params: unknown[] = []) => {
    if (!query.includes("take_rate_limit")) throw new Error(`unexpected query: ${query}`);
    const [key, limit, windowSeconds] = params as [string, number, number];
    asked.push({ key, limit, windowSeconds });
    used[key] = (used[key] ?? 0) + 1;
    return [{ wait: used[key] > limit ? 42 : 0 }];
  }) as unknown as Sql;
  return { sql, asked, used };
}

const ada = { id: "user-ada", email: "ada@postsocial.test", name: "Ada" };
const call = (handler: (request: Request) => Promise<Response>, action: string, token: string | null = "good") =>
  handler(new Request("https://api.example/functions/posts", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action, workspace_id: "w1" }) }));
const handlerWith = (sql: Sql) => createPostsHandler({ sql, userForToken: async (token) => (token === "good" ? ada : null), allowedOrigins: [] });

describe("the posts route's limits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts every action per person by the minute, and the as-you-type check by the hour as well", async () => {
    const { sql, asked } = counters();
    const handler = handlerWith(sql);
    expect((await call(handler, "create")).status).toBe(200);
    expect(asked).toEqual([{ key: "posts_user:user-ada", limit: LIMITS.posts_user.limit, windowSeconds: 60 }]);

    asked.length = 0;
    expect((await call(handler, "validate")).status).toBe(200);
    expect(asked).toEqual([
      { key: "posts_user:user-ada", limit: LIMITS.posts_user.limit, windowSeconds: 60 },
      { key: "posts_check_user:user-ada", limit: LIMITS.posts_check_user.limit, windowSeconds: 3600 },
    ]);
  });

  it("leaves room for someone writing, and none for a page stuck checking once a second", () => {
    // A check follows each pause in typing: two a second at the very most, in bursts.
    expect(LIMITS.posts_user.limit).toBeGreaterThanOrEqual(120);
    // An hour of steady writing is a few hundred checks; a stuck page makes 3,600.
    expect(LIMITS.posts_check_user.limit).toBeGreaterThanOrEqual(1000);
    expect(LIMITS.posts_check_user.limit).toBeLessThan(3600);
  });

  it("stops only the check when its hour is used up: saving and publishing still go through", async () => {
    const { sql } = counters({ "posts_check_user:user-ada": LIMITS.posts_check_user.limit });
    const handler = handlerWith(sql);
    const refused = await call(handler, "validate");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("42");
    expect(await refused.json()).toEqual({ error: "Too many checks this hour. Your post is still checked when you save or publish it." });
    const { postActions } = await import("../../lib/publishing/service");
    expect(postActions.validate).not.toHaveBeenCalled();

    expect((await call(handler, "create")).status).toBe(200);
    expect(postActions.create).toHaveBeenCalledTimes(1);
  });

  it("refuses everything for the rest of the minute when the minute is used up", async () => {
    const { sql } = counters({ "posts_user:user-ada": LIMITS.posts_user.limit });
    const handler = handlerWith(sql);
    for (const action of ["create", "validate"]) {
      const refused = await call(handler, action);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("Retry-After")).toBe("42");
      expect(await refused.json()).toEqual({ error: "Too many requests. Try again in a little while." });
    }
  });

  it("counts nothing for someone who isn't signed in, or for an action that doesn't exist", async () => {
    const { sql, asked } = counters();
    const handler = handlerWith(sql);
    expect((await call(handler, "validate", null)).status).toBe(401);
    expect((await call(handler, "constructor")).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("keeps one person's use from counting against another", async () => {
    const { sql, asked } = counters();
    const handler = createPostsHandler({ sql, userForToken: async (token) => (token ? { ...ada, id: `user-${token}` } : null), allowedOrigins: [] });
    await call(handler, "validate", "ada");
    await call(handler, "validate", "ben");
    expect(asked.map((entry) => entry.key)).toEqual(["posts_user:user-ada", "posts_check_user:user-ada", "posts_user:user-ben", "posts_check_user:user-ben"]);
  });
});
