import { describe, expect, it, vi } from "vitest";
import type { AgentCaller, Sql } from "../access";
import { createApiHandler, type ApiHandlerDeps } from "../../functions/api/handler";
import { callerForKey, newKey } from "./keys";
import { handleMcp, PROTOCOL_VERSIONS } from "./mcp";
import { openApiDocument } from "./openapi";
import { availableOperations, operations, type ApiDeps } from "./operations";
import { matchRoute, queryInput } from "./rest";

const caller = (mode: "live" | "test" = "live"): AgentCaller => ({
  kind: "key",
  credentialId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  actorId: "00000000-0000-4000-8000-000000000003",
  mode,
  displayName: "Claude Code",
  entryPoint: "mcp",
});

const noSql: Sql = async () => {
  throw new Error("no database in unit tests");
};
const deps = (sql: Sql = noSql, analyticsPlatforms: ApiDeps["analyticsPlatforms"] = []): ApiDeps => ({ sql, r2: {} as never, newId: () => "id", webAppUrl: "https://www.postsocial.xyz", analyticsPlatforms });

describe("operations list", () => {
  it("has unique tool names and unique method + path pairs", () => {
    const names = operations.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z_]{2,63}$/);
    const routes = operations.map((o) => `${o.method} ${o.path}`);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("marks every operation that deletes or cancels as destructive, and reads as read-only", () => {
    for (const op of operations) {
      if (/^(delete|cancel)_/.test(op.name)) expect(op.destructive, op.name).toBe(true);
      if (op.method === "GET") expect(op.readOnly, op.name).toBe(true);
    }
  });

  it("covers the Post Bridge core tools", () => {
    const names = new Set(operations.map((o) => o.name));
    for (const name of ["list_social_accounts", "request_connect_link", "create_post", "list_posts", "get_post", "update_post", "delete_post", "list_post_results", "list_media", "delete_media"]) {
      expect(names.has(name), name).toBe(true);
    }
  });
});

describe("REST routing", () => {
  it("matches paths with ids and reports allowed methods", () => {
    const hit = matchRoute("GET", "/v1/posts/abc");
    expect(hit && "operation" in hit && hit.operation.name).toBe("get_post");
    expect(hit && "operation" in hit && hit.params).toEqual({ post_id: "abc" });
    expect(matchRoute("PUT", "/v1/posts/abc")).toEqual({ allowed: ["GET", "PATCH", "DELETE"] });
    expect(matchRoute("GET", "/v1/nope")).toBeNull();
  });

  it("turns query text into the declared types", () => {
    const op = operations.find((o) => o.name === "list_media")!;
    expect(queryInput(op, new URLSearchParams("limit=10&include_hidden=true&media_type=video"))).toEqual({ limit: 10, include_hidden: true, media_type: "video" });
    expect(queryInput(op, new URLSearchParams("limit=ten"))).toEqual({ limit: "ten" });
  });

  it("describes every operation in the OpenAPI document", () => {
    const doc = openApiDocument("https://www.postsocial.xyz/api");
    const ids = Object.values(doc.paths).flatMap((methods) => Object.values(methods).map((m) => (m as { operationId: string }).operationId));
    expect(ids.sort()).toEqual(operations.map((o) => o.name).sort());
    expect(doc.paths["/v1/posts/{post_id}"]).toHaveProperty("patch.requestBody");
  });
});

describe("MCP", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read loosely shaped JSON replies
  const call = (message: unknown, sql?: Sql, mode?: "live" | "test") => handleMcp(deps(sql), caller(mode), message) as Promise<Record<string, any>>;

  it("negotiates the protocol version", async () => {
    const known = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(known.result.protocolVersion).toBe("2025-06-18");
    const unknown = await call({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(unknown.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    expect(unknown.result.capabilities).toEqual({ tools: { listChanged: false } });
  });

  it("answers notifications with nothing and rejects batches", async () => {
    expect(await call({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await call([{ jsonrpc: "2.0", id: 1, method: "ping" }])).error.code).toBe(-32600);
  });

  it("lists every operation as a tool with safety hints", async () => {
    const { result } = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(result.tools).toHaveLength(availableOperations(deps()).length);
    const del = result.tools.find((t: { name: string }) => t.name === "delete_post");
    expect(del.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(del.inputSchema).toMatchObject({ type: "object", required: ["post_id"] });
  });

  it("offers stats tools only where stats are switched on", async () => {
    const off = await handleMcp(deps(), caller(), { jsonrpc: "2.0", id: 1, method: "tools/list" }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(off.result.tools.map((t: { name: string }) => t.name)).not.toContain("list_analytics");
    const on = await handleMcp(deps(noSql, ["instagram"]), caller(), { jsonrpc: "2.0", id: 1, method: "tools/list" }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(on.result.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["list_analytics", "get_post_analytics", "refresh_analytics"]));
    const hidden = await handleMcp(deps(), caller(), { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_analytics" } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(hidden.error.code).toBe(-32602);
    expect(matchRoute("GET", "/v1/analytics", availableOperations(deps()))).toBeNull();
  });

  it("returns tool failures as readable results, not protocol errors", async () => {
    const result = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_post", arguments: { destinations: [] } } }, undefined, "test");
    expect(result.result).toEqual({ content: [{ type: "text", text: expect.stringMatching(/^Test keys cannot publish/) }], isError: true });
    expect((await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nope" } })).error.code).toBe(-32602);
  });

  it("returns structured results for successful tools", async () => {
    const sql = vi.fn(async () => [{ id: "w", name: "My workspace" }]) as unknown as Sql;
    const { result } = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_workspace", arguments: {} } }, sql);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ workspace: { id: "w", name: "My workspace" }, key: { name: "Claude Code", mode: "live" } });
  });

  it("hides unexpected errors behind a plain message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_workspace" } });
    expect(result).toEqual({ content: [{ type: "text", text: "Something went wrong on our side. Try again in a moment." }], isError: true });
    spy.mockRestore();
  });
});

describe("API keys", () => {
  it("makes keys of the expected shape and never queries for malformed ones", async () => {
    const { key, prefix } = newKey("test");
    expect(key).toMatch(/^ps_test_[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(prefix)).toBe(true);
    const sql = vi.fn() as unknown as Sql;
    expect(await callerForKey(sql, "ps_live_short", "api")).toBeNull();
    expect(await callerForKey(sql, null, "api")).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("api function", () => {
  const handler = (over: Partial<ApiHandlerDeps> = {}) =>
    createApiHandler({
      ...deps(),
      callerForKey: async () => null,
      callerForAccessToken: async () => null,
      userForToken: async () => null,
      allowedOrigins: ["https://www.postsocial.xyz"],
      publicApiUrl: "https://www.postsocial.xyz/api",
      ...over,
    });

  it("asks for a key on the API and MCP server", async () => {
    for (const url of ["https://fn/v1/posts", "https://fn/api/v1/posts"]) {
      const response = await handler()(new Request(url));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);
      expect((await response.json()).error.code).toBe("unauthorized");
    }
    expect((await handler()(new Request("https://fn/mcp", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await handler()(new Request("https://fn/mcp"))).status).toBe(405);
  });

  it("serves the API description without a key", async () => {
    const response = await handler()(new Request("https://fn/v1/openapi.json"));
    expect(response.status).toBe(200);
    expect((await response.json()).openapi).toBe("3.1.0");
  });

  it("answers MCP notifications with 202 and routes REST calls", async () => {
    const h = handler({ callerForKey: async () => caller(), sql: (async () => [{ id: "w", name: "Mine" }]) as unknown as Sql });
    const note = await h(new Request("https://fn/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }));
    expect(note.status).toBe(202);
    const me = await h(new Request("https://fn/v1/me", { headers: { Authorization: "Bearer ps_live_x" } }));
    expect(await me.json()).toEqual({ workspace: { id: "w", name: "Mine" }, key: { name: "Claude Code", mode: "live" } });
    const wrong = await h(new Request("https://fn/v1/me", { method: "POST" }));
    expect(wrong.status).toBe(405);
  });

  it("only lets signed-in people manage keys", async () => {
    const response = await handler()(new Request("https://fn/keys", { method: "POST", body: JSON.stringify({ action: "list" }) }));
    expect(response.status).toBe(401);
  });
});
