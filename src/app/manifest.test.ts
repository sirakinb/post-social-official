// @vitest-environment node
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import { GET, POST } from "./beta/share/route";
import { NextRequest } from "next/server";

describe("web app manifest", () => {
  it("installs as an app that opens on Create, with icons that exist", () => {
    const m = manifest();
    expect(m).toMatchObject({ start_url: "/beta/create", display: "standalone" });
    for (const icon of m.icons ?? []) expect(existsSync(path.join(process.cwd(), "public", icon.src)), icon.src).toBe(true);
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public", "apple-touch-icon.png"))).toBe(true);
  });

  it("receives shared photos and videos at /beta/share, which the service worker answers", () => {
    const share = manifest().share_target!;
    expect(share).toMatchObject({ action: "/beta/share", method: "POST", enctype: "multipart/form-data" });
    expect(share.params.files).toEqual([expect.objectContaining({ name: "media", accept: expect.arrayContaining(["video/*", "image/*"]) })]);
    expect(existsSync(path.join(process.cwd(), "public", "sw.js"))).toBe(true);
  });
});

describe("/beta/share without the service worker", () => {
  it("sends the person to Create with an explanation", () => {
    const post = POST(new NextRequest("https://www.postsocial.xyz/beta/share", { method: "POST" }));
    expect(post.status).toBe(303);
    expect(post.headers.get("location")).toBe("https://www.postsocial.xyz/beta/create?shared=failed");
    expect(GET(new NextRequest("https://www.postsocial.xyz/beta/share")).headers.get("location")).toBe("https://www.postsocial.xyz/beta/create");
  });
});
