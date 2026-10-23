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
