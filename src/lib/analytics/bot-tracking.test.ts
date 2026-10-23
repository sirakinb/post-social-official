import { describe, expect, it } from "vitest";
import { botTrackingConfig } from "./bot-tracking";

describe("botTrackingConfig", () => {
  it("is on only on the live site", () => {
    expect(botTrackingConfig("production").enabled).toBe(true);
    for (const env of ["preview", "staging", "development"]) expect(botTrackingConfig(env).enabled).toBe(false);
  });

  it("reports for our own site", () => {
    const config = botTrackingConfig("production");
    expect(config.websiteId).toBe("dfid_ev0xid7Q3dcHOMtmozFCa");
    expect(config.domain).toBe("postsocial.xyz");
  });

  it("tracks public pages and crawler files, not private pages or addresses with a query", () => {
    const track = botTrackingConfig("production").shouldTrackPath!;
    const crawler = { provider: "OpenAI", agent: "GPTBot", category: "training" } as never;
    for (const path of ["/", "/pricing", "/docs/quickstart", "/llms.txt", "/robots.txt", "/sitemap.xml"]) expect(track(new URL(`https://www.postsocial.xyz${path}`), crawler)).toBe(true);
    for (const path of ["/beta", "/beta/accounts", "/oauth/authorize", "/mcp", "/tiktok-media/x", "/docs?token=abc"]) expect(track(new URL(`https://www.postsocial.xyz${path}`), crawler)).toBe(false);
  });
});
