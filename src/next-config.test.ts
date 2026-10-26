// @vitest-environment node
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

async function connectSources() {
  const rules = await nextConfig.headers!();
  const csp = rules[0].headers.find((h) => h.key === "Content-Security-Policy")!.value;
  return csp.split("; ").find((d) => d.startsWith("connect-src"))!.split(" ").slice(1);
}

describe("Content-Security-Policy", () => {
  it("lets the browser upload media parts to our R2 account, and nowhere broader", async () => {
    const sources = await connectSources();
    expect(sources).toContain("https://5e9cbd18080d4f973442560e2140a3e0.r2.cloudflarestorage.com");
    expect(sources.some((s) => s.includes("*.r2.cloudflarestorage.com"))).toBe(false);
  });
});

describe("DataFast", () => {
  it("is allowed to load its script and send page views, from its own address only", async () => {
    const rules = await nextConfig.headers!();
    const csp = rules[0].headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(name))!.split(" ").slice(1);
    expect(directive("script-src")).toContain("https://datafa.st");
    expect(directive("connect-src")).toContain("https://datafa.st");
    expect(directive("script-src")).not.toContain("https:");
  });
});

describe("Rewardful", () => {
  it("loads its script from r.wdfl.co and reports to api.getrewardful.com, nothing broader", async () => {
    const rules = await nextConfig.headers!();
    const csp = rules[0].headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `))!.split(" ").slice(1);
    expect(directive("script-src")).toContain("https://r.wdfl.co");
    expect(directive("connect-src")).toContain("https://api.getrewardful.com");
    expect(directive("script-src")).not.toContain("https://api.getrewardful.com");
    expect(directive("connect-src")).not.toContain("https://r.wdfl.co");
  });
});

describe("Crisp support chat", () => {
  it("is allowed to load and connect, and the app's own service worker still runs", async () => {
    const rules = await nextConfig.headers!();
    const csp = rules[0].headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `))!.split(" ").slice(1);
    for (const name of ["script-src", "style-src", "font-src", "connect-src", "frame-src", "worker-src"]) expect(directive(name)).toContain("https://*.crisp.chat");
    expect(directive("connect-src")).toContain("wss://*.relay.crisp.chat");
    expect(directive("worker-src")).toEqual(expect.arrayContaining(["'self'", "blob:"]));
    expect(directive("frame-src")).not.toContain("https:");
  });
});

describe("PostHog through this site", () => {
  it("forwards /ingest to PostHog without widening the content policy", async () => {
    const rewrites = (await nextConfig.rewrites!()) as Array<{ source: string; destination: string }>;
    expect(rewrites.find((r) => r.source === "/ingest/:path*")?.destination).toBe("https://us.i.posthog.com/:path*");
    expect(rewrites.find((r) => r.source === "/ingest/static/:path*")?.destination).toBe("https://us-assets.i.posthog.com/static/:path*");
    expect((await connectSources()).some((s) => s.includes("posthog"))).toBe(false);
  });
});
