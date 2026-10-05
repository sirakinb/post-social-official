import { describe, expect, it } from "vitest";
import type { AgentCaller, Sql } from "../../lib/access";
import { createApiHandler } from "./handler";

// A database where every rate-limit check answers `wait` (seconds to wait; 0 = allowed).
function fakeSql(wait: number) {
  const keys: string[] = [];
  const sql = (async (query: string, params: unknown[]) => {
    if (query.includes("take_rate_limit")) {
      keys.push(String(params[0]));
      return [{ wait }];
    }
    return [];
  }) as Sql;
  return { sql, keys };
}

const agent: AgentCaller = { kind: "key", credentialId: "key-1", workspaceId: "ws-1", actorId: "actor-1", mode: "live" } as AgentCaller;

const handlerFor = (sql: Sql, proxySecret: string | null = "the-secret") =>
  createApiHandler({
    sql, r2: {} as never, newId: () => crypto.randomUUID(), webAppUrl: "http://localhost:3333", analyticsPlatforms: [], publicApiUrl: "http://localhost:3333/api",
    callerForKey: async () => agent, callerForAccessToken: async () => null, userForToken: async () => null, allowedOrigins: [], proxySecret,
  });

describe("rate limits on the api function", () => {
  it("slows down a key that calls too fast, with Retry-After", async () => {
    const { sql, keys } = fakeSql(17);
    const response = await handlerFor(sql)(new Request("https://fn/v1/accounts", { headers: { Authorization: "Bearer ps_live_x" } }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect((await response.json()).error.message).toMatch(/Wait 17 seconds/);
    expect(keys).toEqual(["api_credential:key-1"]);
  });

  it("applies the same limit over MCP", async () => {
    const { sql } = fakeSql(5);
    const response = await handlerFor(sql)(new Request("https://fn/mcp", { method: "POST", headers: { Authorization: "Bearer ps_live_x" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    expect(response.status).toBe(429);
  });

  it("answers OAuth clients with a standard error and Retry-After", async () => {
    const { sql, keys } = fakeSql(30);
    const response = await handlerFor(sql)(new Request("https://fn/oauth/register", { method: "POST", headers: { "x-forwarded-for": "98.115.239.218" }, body: "{}" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect((await response.json()).error).toBe("temporarily_unavailable");
    expect(keys[0].startsWith("oauth_register_ip:")).toBe(true);
  });

  it("only answers sign-in checks from our website", async () => {
    const { sql, keys } = fakeSql(0);
    const check = (headers: Record<string, string>) => handlerFor(sql)(new Request("https://fn/internal/limits", { method: "POST", headers, body: JSON.stringify({ check: "signin", email: "a@x.com" }) }));
    expect((await check({})).status).toBe(404);
    expect((await check({ "x-ps-proxy-secret": "wrong" })).status).toBe(404);
    expect(keys).toEqual([]);
    const ok = await check({ "x-ps-proxy-secret": "the-secret", "x-ps-client-ip": "203.0.113.9" });
    expect(ok.status).toBe(200);
    expect(keys.map((k) => k.split(":")[0])).toEqual(["signin_ip", "signin_email"]);
  });

  it("turns the sign-in check away when over, so the website can say so", async () => {
    const { sql } = fakeSql(240);
    const response = await handlerFor(sql)(new Request("https://fn/internal/limits", { method: "POST", headers: { "x-ps-proxy-secret": "the-secret" }, body: JSON.stringify({ check: "reset_request", email: "a@x.com" }) }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("240");
  });
});
