// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { GET as youtubeCallback } from "../../../oauth/youtube/callback/route";
import { FLASH_COOKIE, readFlash } from "@/lib/beta/flash";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "person-token" }) }) }));
vi.mock("@insforge/sdk/ssr", () => ({ getAccessTokenCookieName: () => "access" }));

describe("finishing a social account connection", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("CONNECTIONS_BASE_URL", "https://fn.example/connections");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("finishes as the signed-in person and returns them where they started", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, returnTo: "https://www.postsocial.xyz/beta/accounts?workspace=w", platform: "instagram", message: "Connected Test IG." })));
    const response = await GET(new NextRequest("https://www.postsocial.xyz/beta/connect/finish?platform=instagram&state=s1&code=c1"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://fn.example/connections/complete");
    expect(init.headers.Authorization).toBe("Bearer person-token");
    expect(JSON.parse(init.body)).toEqual({ platform: "instagram", params: { state: "s1", code: "c1" } });
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/beta/accounts");
    expect(location.searchParams.get("connected")).toBe("instagram");
  });

  it("shows the refusal when someone else's link was used", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, returnTo: null, platform: "instagram", message: "This Instagram connection request expired, was already used, or was started by someone else." })));
    const response = await GET(new NextRequest("https://www.postsocial.xyz/beta/connect/finish?platform=instagram&state=s1&code=c1"));
    // The address carries only a code; the server's own words ride in a short-lived cookie.
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("connect_failed");
    expect(response.headers.get("location")).not.toMatch(/someone/);
    expect(readFlash(response.cookies.get(FLASH_COOKIE)?.value, "error")).toMatch(/someone else/);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("puts the success message in the cookie and only a code in the address", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, returnTo: null, platform: "instagram", message: "Connected Test IG." })));
    const response = await GET(new NextRequest("https://www.postsocial.xyz/beta/connect/finish?platform=instagram&state=s1&code=c1"));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("message")).toBe("connected");
    expect(readFlash(response.cookies.get(FLASH_COOKIE)?.value, "notice")).toBe("Connected Test IG.");
  });

  it("uses fixed codes when it can't reach the server", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const response = await GET(new NextRequest("https://www.postsocial.xyz/beta/connect/finish?platform=instagram&state=s1&code=c1"));
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("unreachable");
    expect(response.cookies.get(FLASH_COOKIE)).toBeUndefined();
  });

  it("YouTube's callback hands Google's answer to the finish page", () => {
    const response = youtubeCallback(new NextRequest("https://www.postsocial.xyz/oauth/youtube/callback?state=s2&code=c2&scope=x"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/beta/connect/finish");
    expect(Object.fromEntries(location.searchParams)).toEqual({ platform: "youtube", state: "s2", code: "c2", scope: "x" });
  });
});
