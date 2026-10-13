// @vitest-environment node
import { describe, expect, it } from "vitest";
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
