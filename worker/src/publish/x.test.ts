// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { XOptions } from "../../../backend/lib/publishing/validate";
import { hasLink, publishX, xCharges } from "./x";
import type { Sql } from "../../../backend/lib/access";
import { PublishError, type Checkpoint, type StepContext } from "./types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function harness(options: XOptions, media: Array<Partial<StepContext["bundle"]["media"][number]>>, routes: Array<(url: URL, init: RequestInit) => Response | undefined>, checkpoint: Checkpoint = {}) {
  const calls: Array<{ method: string; url: URL; body?: unknown }> = [];
  const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ method: init.method ?? "GET", url, body: init.body });
    for (const route of routes) {
      const r = route(url, init);
      if (r) return r;
    }
    throw new Error(`no stand-in for ${init.method ?? "GET"} ${url}`);
  }) as typeof fetch;
  const ctx: StepContext = {
    bundle: {
      jobId: "j", workspaceId: "w", postId: "p", destinationId: "d", platform: "x", options, caption: "Hello X",
      account: { id: "a", externalId: "42", handle: "sirakinb", displayName: "Aki", scopes: [], capabilities: {} },
      media: media.map((m, i) => ({ id: `m${i}`, name: `f${i}`, status: "ready", media_type: "image", mime_type: "image/jpeg", size_bytes: 1000, width: 1200, height: 800, duration_seconds: null, storage_key: `k${i}`, url: `https://r2.example/f${i}`, ...m })),
    },
    checkpoint: { ...checkpoint },
    save: async (patch) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete ctx.checkpoint[k];
        else ctx.checkpoint[k] = v;
      }
    },
    token: async () => "tok",
    http,
    reserve: async () => undefined,
    renewLease: async () => undefined,
    now: () => Date.parse("2026-10-10T12:00:00Z"),
    sleep: async () => undefined,
    notes: [],
  };
  return { ctx, calls };
}

const storage = (url: URL) => (url.hostname === "r2.example" ? new Response(new Uint8Array(100), { status: 206 }) : undefined);

describe("X posts", () => {
  it("uploads images in parts, adds descriptions, then posts them", async () => {
    let n = 0;
    let post: Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    const h = harness({ kind: "x", alt_text: ["A lantern"] }, [{}, {}], [
      storage,
      (url) => (url.pathname === "/2/media/upload/initialize" ? json({ data: { id: `m-${++n}` } }) : undefined),
      (url) => (/\/append$/.test(url.pathname) ? new Response(null, { status: 204 }) : undefined),
      (url) => (/\/finalize$/.test(url.pathname) ? json({ data: { id: "x" } }) : undefined),
      (url) => (url.pathname === "/2/media/metadata" ? json({ data: {} }) : undefined),
      (url, init) => {
        if (url.pathname !== "/2/tweets") return undefined;
        post = JSON.parse(String(init.body));
        return json({ data: { id: "1900", text: "Hello X" } }, 201);
      },
    ]);
    expect(await publishX(h.ctx)).toEqual({ kind: "published", platformId: "1900", liveUrl: "https://x.com/sirakinb/status/1900" });
    expect(post).toEqual({ text: "Hello X", media: { media_ids: ["m-1", "m-2"] } });
    expect(h.calls.filter((c) => c.url.pathname === "/2/media/metadata")).toHaveLength(1);
  });

  it("waits while X processes a video, without uploading it again", async () => {
    let state = "in_progress";
    const h = harness({ kind: "x" }, [{ media_type: "video", mime_type: "video/mp4", size_bytes: 9 * 1024 * 1024 }], [
      storage,
      (url) => (url.pathname === "/2/media/upload/initialize" ? json({ data: { id: "v1" } }) : undefined),
      (url) => (/\/append$/.test(url.pathname) ? new Response(null, { status: 204 }) : undefined),
      (url) => (/\/finalize$/.test(url.pathname) ? json({ data: { id: "v1", processing_info: { state: "pending" } } }) : undefined),
      (url) => (url.pathname === "/2/media/upload" && url.searchParams.get("command") === "STATUS" ? json({ data: { processing_info: { state } } }) : undefined),
      (url) => (url.pathname === "/2/tweets" ? json({ data: { id: "1901" } }, 201) : undefined),
    ]);
    expect(await publishX(h.ctx)).toMatchObject({ kind: "wait" });
    expect(h.calls.filter((c) => /\/append$/.test(c.url.pathname))).toHaveLength(3);
    state = "succeeded";
    expect(await publishX(h.ctx)).toMatchObject({ kind: "published", platformId: "1901" });
    expect(h.calls.filter((c) => /\/append$/.test(c.url.pathname))).toHaveLength(3);
  });

  it("says plainly when the X credits run out, and lets the post be retried", async () => {
    const h = harness({ kind: "x" }, [], [(url) => (url.pathname === "/2/tweets" ? json({ title: "CreditsDepleted", detail: "Your enrolled account does not have any credits" }, 402) : undefined)]);
    const error = await publishX(h.ctx).catch((e) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error.code).toBe("x_no_credits");
    // It's Post Social's balance, so the person is pointed to support, not the X console.
    expect(error.message).toMatch(/Contact support/);
    expect(error.message).not.toMatch(/Developer Console/);
    expect(h.ctx.checkpoint.publish_started_at).toBeUndefined();
  });

  it("reports an interrupted post instead of posting twice", async () => {
    const h = harness({ kind: "x" }, [], [], { publish_started_at: "2026-10-10T11:59:00Z" });
    await expect(publishX(h.ctx)).rejects.toMatchObject({ code: "unconfirmed" });
  });
});

describe("X charges", () => {
  const tweet = (status = 201) => (url: URL) => (url.pathname === "/2/tweets" ? json(status === 201 ? { data: { id: "1902" } } : { detail: "Forbidden" }, status) : undefined);

  it("charges the post, with the link price when the text has one", async () => {
    const charged: boolean[] = [];
    const h = harness({ kind: "x" }, [], [tweet()]);
    h.ctx.bundle.caption = "Read this www.postsocial.xyz/docs";
    h.ctx.chargeX = { reserve: async (withLink) => void charged.push(withLink), release: async () => undefined };
    await publishX(h.ctx);
    expect(charged).toEqual([true]);
  });

  it("stops at the cap without posting", async () => {
    const h = harness({ kind: "x" }, [], [tweet()]);
    h.ctx.chargeX = { reserve: async () => { throw new PublishError("x_cap_reached", "cap", false); }, release: async () => undefined };
    await expect(publishX(h.ctx)).rejects.toMatchObject({ code: "x_cap_reached" });
    expect(h.calls.filter((c) => c.url.pathname === "/2/tweets")).toHaveLength(0);
  });

  it("gives the charge back when X refuses the post", async () => {
    let released = 0;
    const h = harness({ kind: "x" }, [], [tweet(403)]);
    h.ctx.chargeX = { reserve: async () => undefined, release: async () => void released++ };
    await expect(publishX(h.ctx)).rejects.toMatchObject({ code: "x_forbidden" });
    expect(released).toBe(1);
  });

  it("asks the database with the price in cents and explains a full cap", async () => {
    const calls: unknown[][] = [];
    let answer = "ok";
    const sql = (async (_q: string, params: unknown[]) => (calls.push(params), [{ reserve_x_charge: answer }])) as Sql;
    const charges = xCharges(sql, { destinationId: "d1", workspaceId: "w1" } as never);
    await charges.reserve(false);
    await charges.reserve(true);
    expect(calls).toEqual([["d1", "w1", 2, false, 100], ["d1", "w1", 25, true, 100]]);
    answer = "over_cap";
    await expect(charges.reserve(false)).rejects.toThrow(/monthly X limit/);
  });

  it("spots links the way X does", () => {
    for (const text of ["https://a.co", "see postsocial.xyz", "go to www.example.com/path", "(example.org)"]) expect(hasLink(text)).toBe(true);
    for (const text of ["Hello X", "e.g. this", "mail me@site", "3.14 is pi", "end of sentence.Next"]) expect(hasLink(text)).toBe(false);
  });
});
