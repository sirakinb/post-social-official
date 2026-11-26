// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ answer: { state: "ended" } as { state: string; user?: unknown } }));
vi.mock("@/lib/sign-in/ours", () => ({ ownSession: async () => session.answer }));

import { GET } from "./route";

describe("the page that clears an ended session", () => {
  beforeEach(() => vi.stubEnv("SIGN_IN_URL", "https://api.postsocial.test/auth"));
  afterEach(() => vi.unstubAllEnvs());
  const visit = (query = "?next=/beta/calendar") => GET(new NextRequest(`https://www.postsocial.xyz/beta/auth/ended${query}`, { headers: { cookie: "ps_session=old.token" } }));

  it("clears the cookie and goes to the sign-in page, to come back where the person was going", async () => {
    session.answer = { state: "ended" };
    const response = await visit();
    const location = new URL(response.headers.get("location")!);
    expect([location.pathname, location.searchParams.get("next")]).toEqual(["/beta/login", "/beta/calendar"]);
    expect(response.headers.get("set-cookie")).toMatch(/^ps_session=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });

  it("can't be used to sign someone out: a live session is left alone", async () => {
    session.answer = { state: "signed-in", user: { id: "u1" } };
    const response = await visit();
    expect(new URL(response.headers.get("location")!).pathname).toBe("/beta/calendar");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps the cookie when the API can't be asked, and says so", async () => {
    session.answer = { state: "unknown" };
    const response = await visit();
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toContain("Try again in a moment");
  });

  it("only ever sends people to pages inside the app", async () => {
    session.answer = { state: "ended" };
    for (const next of ["https://evil.example/", "//evil.example", "/pricing"]) {
      const location = new URL((await visit(`?next=${encodeURIComponent(next)}`)).headers.get("location")!);
      expect([location.origin, location.searchParams.get("next")]).toEqual(["https://www.postsocial.xyz", "/beta"]);
    }
    session.answer = { state: "signed-in", user: { id: "u1" } };
    expect((await visit("?next=https://evil.example/")).headers.get("location")).toBe("https://www.postsocial.xyz/beta");
  });

  it("does nothing but point at the sign-in page while sign-in is InsForge's", async () => {
    vi.stubEnv("SIGN_IN_URL", "");
    const response = await visit();
    expect(new URL(response.headers.get("location")!).pathname).toBe("/beta/login");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
