import { describe, expect, it, vi } from "vitest";
import { currentAvatarUrl } from "./platforms";

const answering = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch & { mock: { calls: unknown[][] } };

describe("current profile picture link", () => {
  it("asks each platform where it keeps the picture", async () => {
    const ig = answering({ profile_picture_url: "https://ig/p.jpg" });
    expect(await currentAvatarUrl("instagram", "1", "tok", ig)).toBe("https://ig/p.jpg");
    expect(String(ig.mock.calls[0][0])).toContain("fields=profile_picture_url");

    const threads = answering({ threads_profile_picture_url: "https://th/p.jpg" });
    expect(await currentAvatarUrl("threads", "1", "tok", threads)).toBe("https://th/p.jpg");

    const fb = answering({ data: { url: "https://fb/page.jpg" } });
    expect(await currentAvatarUrl("facebook", "page-9", "tok", fb)).toBe("https://fb/page.jpg");
    expect(String(fb.mock.calls[0][0])).toMatch(/\/page-9\/picture\?redirect=0&type=large/);

    expect(await currentAvatarUrl("tiktok", "1", "tok", answering({ data: { creator_avatar_url: "https://tt/a.jpg" }, error: { code: "ok" } }))).toBe("https://tt/a.jpg");
    expect(await currentAvatarUrl("linkedin", "1", "tok", answering({ sub: "x", picture: "https://li/a.jpg" }))).toBe("https://li/a.jpg");
  });

  it("returns nothing when no picture is shared, and nothing is asked of YouTube", async () => {
    expect(await currentAvatarUrl("linkedin", "1", "tok", answering({ sub: "x" }))).toBeNull();
    const yt = answering({});
    expect(await currentAvatarUrl("youtube", "", "tok", yt)).toBeNull();
    expect(yt.mock.calls).toHaveLength(0);
  });

  it("reports a refusal as an error", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Session expired", code: 190 } }), { status: 400 })) as unknown as typeof fetch;
    await expect(currentAvatarUrl("instagram", "1", "tok", refused)).rejects.toThrow(/Session expired/);
  });
});
