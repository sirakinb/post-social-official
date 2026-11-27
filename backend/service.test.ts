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

function service(overrides: { sql?: Sql; ready?: () => Promise<boolean>; workerSilence?: () => Promise<number | null>; settings?: Record<string, string | undefined>; auth?: { path: string; handler: (request: Request) => Promise<Response> } } = {}) {
  const settings = { ...SETTINGS, ...overrides.settings };
  return createService({
    env: (name) => settings[name],
    base: { sql: overrides.sql ?? (vi.fn(async () => []) as unknown as Sql), userForToken: async () => null },
    ready: overrides.ready ?? (async () => true),
    workerSilence: overrides.workerSilence ?? (async () => 5),
    ...(overrides.auth ? { auth: overrides.auth } : {}),
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

  it("reports the worker as up only while its heartbeat is recent", async () => {
    const worker = async (workerSilence: () => Promise<number | null>) => {
      const response = await get(service({ workerSilence }), "/readyz/worker");
      return [response.status, await response.text()];
    };
    // The uptime check looks for "ok":true in the body.
    expect(await worker(async () => 12.4)).toEqual([200, '{"ok":true,"seconds":12}']);
    expect(await worker(async () => 3600)).toEqual([503, '{"ok":false,"seconds":3600}']);
    // Never beaten, or the database doesn't answer.
    expect(await worker(async () => null)).toEqual([503, '{"ok":false,"seconds":null}']);
    expect(await worker(async () => { throw new Error("down"); })).toEqual([503, '{"ok":false,"seconds":null}']);
    // The database's own readiness is a separate question.
    expect((await get(service({ workerSilence: async () => null }), "/readyz")).status).toBe(200);
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

  it("has no sign-in routes unless sign-in runs here, and then only for our website's server", async () => {
    const signIn = vi.fn(async (request: Request) => new Response(new URL(request.url).pathname));
    // Sign-in is elsewhere: the path is nothing.
    expect((await get(service({ settings: { INTERNAL_PROXY_SECRET: "website-secret" } }), "/auth/sign-in/email", { method: "POST", headers: { "X-PS-Proxy-Secret": "website-secret" } })).status).toBe(404);

    const handler = service({ auth: { path: "/auth", handler: signIn }, settings: { INTERNAL_PROXY_SECRET: "website-secret" } });
    expect((await get(handler, "/auth/sign-in/email", { method: "POST" })).status).toBe(404);
    expect((await get(handler, "/auth/sign-in/email", { method: "POST", headers: { "X-PS-Proxy-Secret": "guess" } })).status).toBe(404);
    expect(signIn).not.toHaveBeenCalled();
    // With the secret, the request arrives with its whole path, which sign-in routes on.
    const answered = await get(handler, "/auth/sign-in/email", { method: "POST", headers: { "X-PS-Proxy-Secret": "website-secret" } });
    expect([answered.status, await answered.text()]).toEqual([200, "/auth/sign-in/email"]);
    // No secret set on the service at all: closed to everyone.
    const unset = service({ auth: { path: "/auth", handler: signIn } });
    expect((await get(unset, "/auth/sign-in/email", { method: "POST", headers: { "X-PS-Proxy-Secret": "" } })).status).toBe(404);
    // A near miss of the path is nothing.
    expect((await get(handler, "/authx/sign-in/email", { method: "POST", headers: { "X-PS-Proxy-Secret": "website-secret" } })).status).toBe(404);
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
