// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { proxyToInsForge, tiktokRedirect } from "./forward";

describe("TikTok sign-in", () => {
  it("goes on to InsForge with the same query", () => {
    const response = tiktokRedirect("https://vibrant-donkey-218.convex.site/api/oauth/tiktok/callback?code=abc&state=xyz&scopes=user.info.basic");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://syydd6ck.function2.insforge.app/connections/oauth/tiktok/callback?code=abc&state=xyz&scopes=user.info.basic");
  });
});

describe("Meta callbacks", () => {
  it("pass the signed request through and return InsForge's answer", async () => {
    const http = vi.fn(async () => new Response('{"url":"u","confirmation_code":"c"}', { status: 200, headers: { "content-type": "application/json" } }));
    const request = new Request("https://vibrant-donkey-218.convex.site/api/meta/data-deletion", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "signed_request=a.b",
    });
    const response = await proxyToInsForge(request, http as unknown as typeof fetch);
    expect(http).toHaveBeenCalledWith("https://syydd6ck.function2.insforge.app/connections/meta/data-deletion", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "signed_request=a.b",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "u", confirmation_code: "c" });
  });

  it("forwards the status check with its code", async () => {
    const http = vi.fn(async () => new Response("{}", { status: 404 }));
    await proxyToInsForge(new Request("https://x.convex.site/api/meta/data-deletion/status?code=abc"), http as unknown as typeof fetch);
    expect(http).toHaveBeenCalledWith("https://syydd6ck.function2.insforge.app/connections/meta/data-deletion/status?code=abc", { method: "GET", headers: {}, body: undefined });
  });
});
