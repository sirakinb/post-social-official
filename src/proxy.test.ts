// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

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
