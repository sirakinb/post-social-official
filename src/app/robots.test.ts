// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { robotsText } from "@/lib/robots";
import sitemap from "./sitemap";

afterEach(() => vi.unstubAllEnvs());

describe("robots.txt", () => {
  it("lets crawlers read the public site, not the signed-in app or AI approval screens, and says how it may be used", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    expect(robotsText()).toBe(
      ["User-Agent: *", "Content-Signal: search=yes, ai-input=yes, ai-train=yes", "Allow: /", "Allow: /beta/login", "Allow: /beta/signup", "Disallow: /beta/", "Disallow: /oauth/", "", "Sitemap: https://www.postsocial.xyz/sitemap.xml", ""].join("\n"),
    );
  });

  it("asks crawlers to stay off previews and staging", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "preview");
    expect(robotsText()).toBe("User-Agent: *\nDisallow: /\n");
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
