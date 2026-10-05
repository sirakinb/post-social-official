import { describe, expect, it } from "vitest";
import type { Sql } from "./access";
import { joinWaitlist, normalizeEmail, WAITLIST_BURST } from "./waitlist";
import { createApiHandler } from "../functions/api/handler";

function fakeSql(recent = 0, wait = 0) {
  const calls: { query: string; params: unknown[] }[] = [];
  const sql = (async (query: string, params: unknown[]) => {
    calls.push({ query, params });
    if (query.includes("take_rate_limit")) return [{ wait }];
    return query.includes("count(*)") ? [{ n: recent }] : [];
  }) as Sql;
  return { sql, calls };
}

describe("normalizeEmail", () => {
  it("trims and lowercases good addresses", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });
  it("rejects anything that is not one plain address", () => {
    for (const bad of ["", "ada", "ada@", "@x.com", "a b@x.com", "ada@x", "a@b.c", "<a@x.com>", "a@x.com, b@x.com", 42, null, `${"a".repeat(250)}@x.com`]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});

describe("joinWaitlist", () => {
  it("adds the email once and answers the same either way", async () => {
    const { sql, calls } = fakeSql();
    await expect(joinWaitlist(sql, { email: "Ada@Example.com", source: "landing" })).resolves.toEqual({ ok: true });
    const insert = calls.find((c) => c.query.includes("INSERT"));
    expect(insert?.query).toMatch(/ON CONFLICT \(email\) DO NOTHING/);
    expect(insert?.params).toEqual(["ada@example.com", "landing"]);
  });
  it("refuses a bad email before touching the database", async () => {
    const { sql, calls } = fakeSql();
    await expect(joinWaitlist(sql, { email: "nope" })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });
  it("slows down a burst of sign-ups", async () => {
    const { sql, calls } = fakeSql(WAITLIST_BURST.limit);
    await expect(joinWaitlist(sql, { email: "ada@example.com" })).rejects.toMatchObject({ status: 429 });
    expect(calls.some((c) => c.query.includes("INSERT"))).toBe(false);
  });
});

describe("the /waitlist route", () => {
  const handler = (sql: Sql) =>
    createApiHandler({
      sql, r2: {} as never, newId: () => crypto.randomUUID(), webAppUrl: "http://localhost:3333", analyticsPlatforms: [], publicApiUrl: "http://localhost:3333/api",
      callerForKey: async () => null, callerForAccessToken: async () => null, userForToken: async () => null, allowedOrigins: [],
    });
  const post = (body: string, sql = fakeSql().sql) => handler(sql)(new Request("https://fn/waitlist", { method: "POST", body }));

  it("needs no sign-in and answers ok", async () => {
    const response = await post(JSON.stringify({ email: "ada@example.com" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
  it("explains bad input", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
    expect((await post(JSON.stringify({ email: "x" }))).status).toBe(400);
    expect((await post(JSON.stringify({ email: "a@x.com", pad: "x".repeat(3000) }))).status).toBe(413);
  });
  it("limits each visitor, by the address the gateway saw", async () => {
    const { sql, calls } = fakeSql(0, 1800);
    const response = await handler(sql)(new Request("https://fn/waitlist", { method: "POST", headers: { "x-forwarded-for": "6.6.6.6, 98.115.239.218" }, body: JSON.stringify({ email: "a@x.com" }) }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1800");
    expect(calls.some((c) => c.query.includes("INSERT"))).toBe(false);
    const key = String(calls.find((c) => c.query.includes("take_rate_limit"))?.params[0]);
    expect(key.startsWith("waitlist_ip:")).toBe(true);
    expect(key).not.toContain("98.115");
  });

  it("only takes POST", async () => {
    const response = await handler(fakeSql().sql)(new Request("https://fn/waitlist"));
    expect(response.status).toBe(405);
  });
});
