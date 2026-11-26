// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const track = vi.hoisted(() => vi.fn());
vi.mock("@datafast/ai-crawl", () => ({ trackAICrawlerRequest: track }));

describe("proxy: visitor address for the API", () => {
  beforeEach(() => vi.stubEnv("INTERNAL_PROXY_SECRET", "the-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("passes the visitor's address and the proof to forwarded API requests", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/api/v1/accounts", { headers: { "x-real-ip": "203.0.113.9" } }));
    expect(response.headers.get("x-middleware-request-x-ps-client-ip")).toBe("203.0.113.9");
    expect(response.headers.get("x-middleware-request-x-ps-proxy-secret")).toBe("the-secret");
  });

  it("replaces whatever a caller claimed", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/mcp", { method: "POST", headers: { "x-real-ip": "203.0.113.9", "x-ps-client-ip": "1.1.1.1", "x-ps-proxy-secret": "guess" } }));
    expect(response.headers.get("x-middleware-request-x-ps-client-ip")).toBe("203.0.113.9");
    expect(response.headers.get("x-middleware-request-x-ps-proxy-secret")).toBe("the-secret");
  });

  it("leaves other well-known paths alone (no sign-in redirect)", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/.well-known/security.txt"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-ps-client-ip")).toBeNull();
  });
});

describe("proxy: crawler tracking", () => {
  beforeEach(() => track.mockClear());
  afterEach(() => {
    vi.unstubAllEnvs();
    track.mockClear();
  });

  it("hands every request to DataFast, switched on only on the live site", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    const request = new NextRequest("https://www.postsocial.xyz/pricing", { headers: { "user-agent": "GPTBot/1.0" } });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeNull();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0]).toBe(request);
    expect(track.mock.calls[0][2]).toMatchObject({ websiteId: "dfid_ev0xid7Q3dcHOMtmozFCa", enabled: true });
  });

  it("is switched off on previews", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "preview");
    await proxy(new NextRequest("https://www.postsocial.xyz/pricing"));
    expect(track.mock.calls[0][2]).toMatchObject({ enabled: false });
  });
});

describe("proxy: Markdown for agents", () => {
  it("sends agents that ask for Markdown on a public page to its Markdown", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/docs/quickstart", { headers: { accept: "text/markdown" } }));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.postsocial.xyz/markdown/docs/quickstart");
    expect(response.headers.get("vary")).toBe("Accept");
  });

  it("gives browsers the normal page, marked as varying by Accept", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/pricing", { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" } }));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept");
  });

  it("never applies to the app or the API", async () => {
    const app = await proxy(new NextRequest("https://www.postsocial.xyz/beta/signup", { headers: { accept: "text/markdown" } }));
    expect(app.headers.get("x-middleware-rewrite")).toBeNull();
    const api = await proxy(new NextRequest("https://www.postsocial.xyz/api/v1/accounts", { headers: { accept: "text/markdown" } }));
    expect(api.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("proxy: Link headers", () => {
  it("adds discovery Link headers to the home page only", async () => {
    const home = await proxy(new NextRequest("https://www.postsocial.xyz/", { headers: { accept: "text/html" } }));
    expect(home.headers.get("link")).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    const pricing = await proxy(new NextRequest("https://www.postsocial.xyz/pricing", { headers: { accept: "text/html" } }));
    expect(pricing.headers.get("link")).toBeNull();
  });
});

describe("proxy: the app under /beta with our own sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("SIGN_IN_URL", "https://api.postsocial.test/auth");
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => vi.unstubAllEnvs());
  const withSession = { headers: { cookie: "ps_session=signed.token" } };

  it("sends a signed-out visitor to the sign-in page, to come back where they were going", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/beta/calendar?view=week"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/beta/login");
    expect(location.searchParams.get("next")).toBe("/beta/calendar?view=week");
  });

  it("lets signed-out visitors open the sign-in, sign-up and reset pages", async () => {
    for (const path of ["/beta/login", "/beta/signup", "/beta/reset-password", "/beta/auth/ended"]) {
      expect((await proxy(new NextRequest(`https://www.postsocial.xyz${path}`))).headers.get("location"), path).toBeNull();
    }
  });

  it("lets a browser with a session through and keeps it signed in for another 30 days", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/beta/calendar", withSession));
    expect(response.headers.get("location")).toBeNull();
    const cookie = response.cookies.get("ps_session");
    expect(cookie).toMatchObject({ value: "signed.token", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2592000 });
  });

  it("leaves the cookie alone on a server action, which would otherwise load the whole page again after each one", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/beta/create", { method: "POST", headers: { cookie: "ps_session=signed.token", "next-action": "abc123" } }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("ps_session")).toBeUndefined();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-set-cookie")).toBeNull();
  });

  it("still turns a signed-out server action away", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/beta/create", { method: "POST", headers: { "next-action": "abc123" } }));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/beta/login");
  });

  it("sends a signed-in person away from the sign-in page, but never away from the page that clears an ended session", async () => {
    expect(new URL((await proxy(new NextRequest("https://www.postsocial.xyz/beta/login", withSession))).headers.get("location")!).pathname).toBe("/beta");
    expect((await proxy(new NextRequest("https://www.postsocial.xyz/beta/auth/ended?next=/beta", withSession))).headers.get("location")).toBeNull();
  });

  it("takes no notice of InsForge's cookies", async () => {
    const response = await proxy(new NextRequest("https://www.postsocial.xyz/beta/calendar", { headers: { cookie: "insforge_access_token=abc; insforge_refresh_token=def" } }));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/beta/login");
  });
});
