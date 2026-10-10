import { describe, expect, it } from "vitest";
import type { Sql } from "../../lib/access";
import { createApiHandler } from "./handler";

const ACCOUNT = "0b6f3c2e-4a5d-4e8f-9a1b-2c3d4e5f6a7b";
const KEY = `workspaces/ws/avatars/${ACCOUNT}/0123456789abcdef.jpg`;

function handler(rows: Array<{ avatar_key: string }>) {
  const queries: unknown[][] = [];
  const sql = (async (_query: string, params: unknown[]) => {
    queries.push(params);
    return rows;
  }) as Sql;
  const r2 = { presignGet: async (key: string, seconds: number) => `https://r2.example/${key}?expires=${seconds}` };
  const handle = createApiHandler({
    sql, r2: r2 as never, newId: () => "id", webAppUrl: "http://localhost:3333", analyticsPlatforms: [], publicApiUrl: "http://localhost:3333/api",
    callerForKey: async () => null, callerForAccessToken: async () => null, userForToken: async () => null, allowedOrigins: [],
  });
  return { handle, queries };
}

describe("saved profile pictures", () => {
  it("sends a picture's address on to a short-lived storage link, cacheable since the version is in the address", async () => {
    const { handle, queries } = handler([{ avatar_key: KEY }]);
    const response = await handle(new Request(`https://fn/api/avatars/${ACCOUNT}/0123456789abcdef`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`https://r2.example/${KEY}?expires=7200`);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(queries[0]).toEqual([ACCOUNT]);
  });

  it("refuses an old version, a malformed address, and accounts without a saved picture", async () => {
    expect((await handler([{ avatar_key: KEY }]).handle(new Request(`https://fn/avatars/${ACCOUNT}/ffffffffffffffff`))).status).toBe(404);
    expect((await handler([]).handle(new Request(`https://fn/avatars/${ACCOUNT}/0123456789abcdef`))).status).toBe(404);
    const malformed = handler([{ avatar_key: KEY }]);
    expect((await malformed.handle(new Request("https://fn/avatars/../secrets/0123456789abcdef"))).status).toBe(404);
    expect((await malformed.handle(new Request(`https://fn/avatars/${ACCOUNT}`))).status).toBe(404);
    expect(malformed.queries).toEqual([]);
  });

  it("only answers GET", async () => {
    const response = await handler([{ avatar_key: KEY }]).handle(new Request(`https://fn/avatars/${ACCOUNT}/0123456789abcdef`, { method: "POST" }));
    expect(response.status).toBe(405);
  });
});
