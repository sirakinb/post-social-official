// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

afterEach(() => vi.unstubAllEnvs());

describe("robots.txt", () => {
  it("lets crawlers read the public site, not the signed-in app or AI approval screens", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    const r = robots();
    expect(r.rules).toEqual({ userAgent: "*", allow: ["/", "/beta/login", "/beta/signup"], disallow: ["/beta/", "/oauth/"] });
    expect(r.sitemap).toBe("https://www.postsocial.xyz/sitemap.xml");
  });

  it("asks crawlers to stay off previews and staging", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "preview");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("sitemap", () => {
  it("lists the public pages and every docs page, once each, on the live address", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const url of ["https://www.postsocial.xyz", "https://www.postsocial.xyz/pricing", "https://www.postsocial.xyz/docs", "https://www.postsocial.xyz/docs/quickstart", "https://www.postsocial.xyz/docs/billing", "https://www.postsocial.xyz/privacy"]) expect(urls).toContain(url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some((url) => url.includes("/beta") || url.includes("/oauth"))).toBe(false);
  });
});
