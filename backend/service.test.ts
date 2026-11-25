// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "./lib/access";
import { setErrorReporter, type Telemetry } from "./lib/telemetry";
import { createService } from "./service";

const SETTINGS: Record<string, string> = {
  WEB_APP_HOME: "https://www.postsocial.xyz/beta/accounts",
  WEB_APP_ORIGINS: "https://www.postsocial.xyz",
  R2_ACCOUNT_ID: "acct", R2_BUCKET: "bucket", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret",
  CONNECTIONS_BASE_URL: "https://api.postsocial.xyz/connections",
  META_WEBHOOK_VERIFY_TOKEN: "verify-me",
};

function service(overrides: { sql?: Sql; ready?: () => Promise<boolean>; settings?: Record<string, string | undefined> } = {}) {
  const settings = { ...SETTINGS, ...overrides.settings };
  return createService({
    env: (name) => settings[name],
    base: { sql: overrides.sql ?? (vi.fn(async () => []) as unknown as Sql), userForToken: async () => null },
    ready: overrides.ready ?? (async () => true),
  });
}
const get = (handler: ReturnType<typeof service>, path: string, init?: RequestInit) => handler(new Request(`https://api.postsocial.xyz${path}`, init));

afterEach(() => setErrorReporter(null));

describe("the Node service", () => {
  it("says it is up without touching the database", async () => {
    const sql = vi.fn(async () => []) as unknown as Sql;
    const response = await get(service({ sql }), "/healthz");
    expect([response.status, await response.json()]).toEqual([200, { ok: true }]);
    expect(sql).not.toHaveBeenCalled();
  });

  it("reports ready only when the database answers", async () => {
    expect((await get(service(), "/readyz")).status).toBe(200);
    expect((await get(service({ ready: async () => false }), "/readyz")).status).toBe(503);
    expect((await get(service({ ready: async () => { throw new Error("down"); } }), "/readyz")).status).toBe(503);
  });

  it("serves the API under /api, with the function's name taken off the path", async () => {
    const handler = service();
    const openapi = await get(handler, "/api/v1/openapi.json");
    expect(openapi.status).toBe(200);
    expect((await openapi.json()).servers[0].url).toBe("https://www.postsocial.xyz/api");
    expect((await get(handler, "/api/v1/accounts")).status).toBe(401);
    // Not under its mount, the same path is nothing.
    expect((await get(handler, "/v1/openapi.json")).status).toBe(404);
  });

  it("serves connections under /connections, query string intact", async () => {
    const handler = service();
    const ok = await get(handler, "/connections/meta/webhooks?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=4242");
    expect([ok.status, await ok.text()]).toEqual([200, "4242"]);
    expect((await get(handler, "/connections/meta/webhooks?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status).toBe(403);
  });

  it("serves media and posts at their short paths and at the paths the web app uses today, body intact", async () => {
    const handler = service();
    for (const path of ["/media", "/functions/media", "/posts", "/functions/posts"]) {
      const response = await get(handler, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) });
      expect(response.status, path).toBe(401); // reached the handler, which wants a sign-in
    }
    expect((await get(handler, "/functions/media", { method: "GET" })).status).toBe(405);
  });

  it("answers 404 for anything else, including near misses of a mount", async () => {
    const handler = service();
    for (const path of ["/", "/apix/v1/openapi.json", "/mediax", "/functions", "/functions/api/v1/openapi.json"]) expect((await get(handler, path)).status, path).toBe(404);
  });

  it("answers a plain 500 and reports the error when the database fails mid-request", async () => {
    const captureException = vi.fn(async () => {});
    setErrorReporter({ captureException, capture: async () => {} } as Telemetry);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sql = vi.fn(async () => { throw new Error("relation \"secret_table\" does not exist"); }) as unknown as Sql;
    const response = await get(service({ sql }), "/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@example.com" }) });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/secret_table/);
    expect(captureException).toHaveBeenCalled();
  });

  it("names the missing setting, never a value, when one isn't there", () => {
    expect(() => service({ settings: { R2_BUCKET: undefined } })).toThrow("Missing secret R2_BUCKET");
  });
});
