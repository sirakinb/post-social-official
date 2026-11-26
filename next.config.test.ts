// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "./next.config";

describe("old app addresses", () => {
  it("send /app and /login to the web app", async () => {
    expect(await nextConfig.redirects!()).toEqual([
      { source: "/app", destination: "/beta", permanent: false },
      { source: "/app/:path*", destination: "/beta", permanent: false },
      { source: "/login", destination: "/beta/login", permanent: false },
    ]);
  });

  it("no longer let pages talk to Convex", async () => {
    const [{ headers }] = await nextConfig.headers!();
    const policy = headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(policy).not.toMatch(/convex/);
  });
});

describe("addresses the platforms call", () => {
  afterEach(() => vi.unstubAllEnvs());

  const rewrites = async () => (await nextConfig.rewrites!()) as { source: string; destination: string }[];
  const to = (rules: { source: string; destination: string }[], source: string) => rules.find((r) => r.source === source)?.destination;

  it("are forwarded from our domain to the connections function and the API", async () => {
    vi.stubEnv("CONNECTIONS_BASE_URL", "https://fn.example/connections");
    vi.stubEnv("API_BASE_URL", "https://fn.example/api");
    const rules = await rewrites();
    expect(to(rules, "/oauth/:platform(instagram|facebook|threads|linkedin|bluesky|x)/callback")).toBe("https://fn.example/connections/oauth/:platform/callback");
    expect(to(rules, "/oauth/bluesky/client-metadata.json")).toBe("https://fn.example/connections/oauth/bluesky/client-metadata.json");
    expect(to(rules, "/oauth/bluesky/jwks.json")).toBe("https://fn.example/connections/oauth/bluesky/jwks.json");
    expect(to(rules, "/meta/data-deletion")).toBe("https://fn.example/connections/meta/data-deletion");
    expect(to(rules, "/meta/data-deletion/status")).toBe("https://fn.example/connections/meta/data-deletion/status");
    expect(to(rules, "/meta/deauthorize")).toBe("https://fn.example/connections/meta/deauthorize");
    expect(to(rules, "/meta/webhooks")).toBe("https://fn.example/connections/meta/webhooks");
    expect(to(rules, "/stripe/webhook")).toBe("https://fn.example/api/stripe/webhook");
  });

  it("leave YouTube and TikTok to their own pages, and forward nothing else under /oauth or /meta", async () => {
    vi.stubEnv("CONNECTIONS_BASE_URL", "https://fn.example/connections");
    vi.stubEnv("API_BASE_URL", "https://fn.example/api");
    const forwarded = (await rewrites()).filter((r) => r.destination.startsWith("https://fn.example/connections"));
    expect(forwarded.map((r) => r.source).sort()).toEqual([
      "/meta/data-deletion",
      "/meta/data-deletion/status",
      "/meta/deauthorize",
      "/meta/webhooks",
      "/oauth/:platform(instagram|facebook|threads|linkedin|bluesky|x)/callback",
      "/oauth/bluesky/client-metadata.json",
      "/oauth/bluesky/jwks.json",
    ]);
    expect(forwarded.some((r) => /youtube|tiktok|:path\*/.test(r.source))).toBe(false);
  });

  it("are left out when the backend addresses are not set", async () => {
    vi.stubEnv("CONNECTIONS_BASE_URL", "");
    vi.stubEnv("API_BASE_URL", "");
    const rules = await rewrites();
    expect(rules.some((r) => r.source.startsWith("/oauth") || r.source.startsWith("/meta") || r.source.startsWith("/stripe"))).toBe(false);
  });
});
