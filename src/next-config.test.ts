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

describe("PostHog through this site", () => {
  it("forwards /ingest to PostHog without widening the content policy", async () => {
    const rewrites = (await nextConfig.rewrites!()) as Array<{ source: string; destination: string }>;
    expect(rewrites.find((r) => r.source === "/ingest/:path*")?.destination).toBe("https://us.i.posthog.com/:path*");
    expect(rewrites.find((r) => r.source === "/ingest/static/:path*")?.destination).toBe("https://us-assets.i.posthog.com/static/:path*");
    expect((await connectSources()).some((s) => s.includes("posthog"))).toBe(false);
  });
});
