import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { finishRedirect } from "./finish-redirect";
import { GET as tiktok } from "./tiktok/callback/route";
import { GET as youtube } from "./youtube/callback/route";

describe("sign-in callbacks on our own domain", () => {
  it("hands the platform's answer to /beta/connect/finish on the same site, unchanged", () => {
    const response = finishRedirect(new URL("https://www.postsocial.xyz/oauth/tiktok/callback?code=abc&state=xyz&scopes=user.info.basic,video.list"), "tiktok");
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://www.postsocial.xyz");
    expect(location.pathname).toBe("/beta/connect/finish");
    expect(Object.fromEntries(location.searchParams)).toEqual({ code: "abc", state: "xyz", scopes: "user.info.basic,video.list", platform: "tiktok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("passes a refusal through so the finish page can explain it", () => {
    const response = finishRedirect(new URL("http://localhost:3333/oauth/tiktok/callback?error=access_denied&state=xyz"), "tiktok");
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("http://localhost:3333");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("platform")).toBe("tiktok");
  });

  it("never lets the query pick the platform", () => {
    const response = finishRedirect(new URL("https://www.postsocial.xyz/oauth/tiktok/callback?platform=youtube&code=abc"), "tiktok");
    expect(new URL(response.headers.get("location")!).searchParams.get("platform")).toBe("tiktok");
  });

  it("serves TikTok and YouTube from their own pages", () => {
    const t = tiktok(new NextRequest("https://www.postsocial.xyz/oauth/tiktok/callback?code=1&state=s"));
    const y = youtube(new NextRequest("https://www.postsocial.xyz/oauth/youtube/callback?code=2&state=s"));
    expect(new URL(t.headers.get("location")!).searchParams.get("platform")).toBe("tiktok");
    expect(new URL(y.headers.get("location")!).searchParams.get("platform")).toBe("youtube");
  });
});
