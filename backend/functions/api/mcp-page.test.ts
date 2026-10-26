import { describe, expect, it } from "vitest";
import type { Sql } from "../../lib/access";
import { createApiHandler } from "./handler";

const handler = createApiHandler({
  sql: (async () => []) as Sql, r2: {} as never, newId: () => crypto.randomUUID(), webAppUrl: "https://www.postsocial.xyz", analyticsPlatforms: [], publicApiUrl: "https://www.postsocial.xyz/api",
  callerForKey: async () => null, callerForAccessToken: async () => null, userForToken: async () => null, allowedOrigins: [], proxySecret: null,
});

describe("the MCP address opened in a browser", () => {
  it("explains what it is instead of showing an error", async () => {
    const response = await handler(new Request("https://fn/mcp", { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    const page = await response.text();
    expect(page).toContain("Post Social's address for AI apps");
    expect(page).toContain("https://www.postsocial.xyz/docs/connect");
  });

  it("still answers MCP clients that try to open an event stream with 405", async () => {
    const response = await handler(new Request("https://fn/mcp", { headers: { Accept: "text/event-stream" } }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
