// @vitest-environment node
import { describe, expect, it } from "vitest";
import { newDpopKey, type BlueskySession } from "../../../backend/lib/connections/atproto";
import type { BlueskyOptions } from "../../../backend/lib/publishing/validate";
import { facetsFor, fitImage, MAX_IMAGE_BYTES, newTid, publishBluesky } from "./bluesky";
import { PublishError, type Checkpoint, type StepContext } from "./types";

const PDS = "https://pds.example.com";
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function harness(options: BlueskyOptions, media: Array<Partial<StepContext["bundle"]["media"][number]>>, routes: Array<(url: URL, init: RequestInit) => Response | undefined>, checkpoint: Checkpoint = {}) {
  const session: BlueskySession = { accessToken: "at", refreshToken: "rt", dpopJwk: await newDpopKey(), server: { issuer: "https://bsky.social", par: "", authorization: "", token: "" }, did: DID, pds: PDS, accessExpiresAt: Date.now() + 3600_000 };
  const calls: Array<{ method: string; url: URL; body?: unknown; headers: Headers }> = [];
  const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ method: init.method ?? "GET", url, body: init.body, headers: new Headers(init.headers) });
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    throw new Error(`no stand-in for ${init.method ?? "GET"} ${url}`);
  }) as typeof fetch;
  const ctx: StepContext = {
    bundle: {
      jobId: "j", workspaceId: "w", postId: "p", destinationId: "d", platform: "bluesky", options, caption: "Hello",
      account: { id: "a", externalId: DID, handle: "aki.bsky.social", displayName: "Aki", scopes: [], capabilities: {} },
      media: media.map((m, i) => ({ id: `m${i}`, name: `f${i}`, status: "ready", media_type: "image", mime_type: "image/jpeg", size_bytes: 1000, width: 1200, height: 800, duration_seconds: null, storage_key: `k${i}`, url: `https://r2.example/f${i}`, ...m })),
    },
    checkpoint: { ...checkpoint },
    save: async (patch) => void Object.assign(ctx.checkpoint, patch),
    token: async () => "at",
    session: async () => session as unknown as Record<string, unknown> & { accessToken: string },
    http,
    reserve: async () => undefined,
    renewLease: async () => undefined,
    now: () => Date.parse("2026-10-10T12:00:00Z"),
    sleep: async () => undefined,
    notes: [],
  };
  return { ctx, calls };
}

const blob = (cid: string) => ({ $type: "blob", ref: { $link: cid }, mimeType: "image/jpeg", size: 900 });

describe("Bluesky posts", () => {
  it("uploads the images, then posts them with links, mentions and hashtags marked", async () => {
    let record: Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    const h = await harness({ kind: "bluesky", text: "New drop 🎉 https://postsocial.xyz with @friend.bsky.social #launch", alt_text: ["A lantern"] }, [{}, {}], [
      (url) => (url.hostname === "r2.example" ? new Response(new Uint8Array(500)) : undefined),
      (url) => (url.pathname.endsWith("uploadBlob") ? json({ blob: blob(`cid-${Math.random()}`) }) : undefined),
      (url) => (url.pathname.endsWith("resolveHandle") ? json({ did: "did:plc:friendfriendfriendfriend" }) : undefined),
      (url, init) => {
        if (!url.pathname.endsWith("createRecord")) return undefined;
        record = JSON.parse(String(init.body));
        return json({ uri: `at://${DID}/app.bsky.feed.post/${record!.rkey}`, cid: "c" });
      },
    ]);
    const result = await publishBluesky(h.ctx);
    expect(result).toMatchObject({ kind: "published", liveUrl: `https://bsky.app/profile/aki.bsky.social/post/${record!.rkey}` });
    expect(h.calls.filter((c) => c.url.pathname.endsWith("uploadBlob"))).toHaveLength(2);
    const create = h.calls.find((c) => c.url.pathname.endsWith("createRecord"))!;
    expect(create.url.origin).toBe(PDS);
    expect(create.headers.get("Authorization")).toBe("DPoP at");
    expect(record!.record.embed.images).toHaveLength(2);
    expect(record!.record.embed.images[0]).toMatchObject({ alt: "A lantern", aspectRatio: { width: 1200, height: 800 } });
    expect(record!.record.facets.map((f: { features: Array<{ $type: string }> }) => f.features[0].$type)).toEqual([
      "app.bsky.richtext.facet#link", "app.bsky.richtext.facet#mention", "app.bsky.richtext.facet#tag",
    ]);
    expect(h.ctx.checkpoint.publish_started_at).toBeTruthy();
  });

  it("looks up an interrupted post under its saved key instead of posting again", async () => {
    const h = await harness({ kind: "bluesky" }, [], [
      (url) => (url.pathname.endsWith("getRecord") && url.searchParams.get("rkey") === "3abc" ? json({ uri: `at://${DID}/app.bsky.feed.post/3abc` }) : undefined),
    ], { rkey: "3abc", publish_started_at: "2026-10-10T11:59:00Z" });
    expect(await publishBluesky(h.ctx)).toMatchObject({ kind: "published", liveUrl: "https://bsky.app/profile/aki.bsky.social/post/3abc" });
    expect(h.calls.some((c) => c.url.pathname.endsWith("createRecord"))).toBe(false);
  });

  it("sends videos to the video service and waits while it processes", async () => {
    let state = "JOB_STATE_ENCODING";
    const h = await harness({ kind: "bluesky" }, [{ media_type: "video", mime_type: "video/mp4", width: 1080, height: 1920 }], [
      (url) => (url.hostname === "r2.example" ? new Response(new Uint8Array(2000)) : undefined),
      (url) => (url.pathname.endsWith("getServiceAuth") ? json({ token: "svc" }) : undefined),
      (url) => (url.pathname.endsWith("uploadVideo") ? json({ jobId: "job-1", state: "JOB_STATE_CREATED" }) : undefined),
      (url) => (url.pathname.endsWith("getJobStatus") ? json({ jobStatus: { jobId: "job-1", state, ...(state === "JOB_STATE_COMPLETED" ? { blob: { ...blob("vid"), mimeType: "video/mp4" } } : {}) } }) : undefined),
      (url) => (url.pathname.endsWith("createRecord") ? json({ uri: `at://${DID}/app.bsky.feed.post/x` }) : undefined),
    ]);
    expect(await publishBluesky(h.ctx)).toMatchObject({ kind: "wait" });
    const auth = h.calls.find((c) => c.url.pathname.endsWith("getServiceAuth"))!;
    expect(auth.url.searchParams.get("aud")).toBe("did:web:pds.example.com");
    expect(h.calls.find((c) => c.url.pathname.endsWith("uploadVideo"))!.headers.get("Authorization")).toBe("Bearer svc");
    state = "JOB_STATE_COMPLETED";
    expect(await publishBluesky(h.ctx)).toMatchObject({ kind: "published" });
    expect(h.calls.filter((c) => c.url.pathname.endsWith("uploadVideo"))).toHaveLength(1);
  });

  it("asks to reconnect when Bluesky refuses the access", async () => {
    const h = await harness({ kind: "bluesky" }, [], [(url) => (url.pathname.endsWith("createRecord") ? json({ error: "invalid_token", message: "bad token" }, 401) : undefined)]);
    h.ctx.bundle.caption = "hi";
    const error = await publishBluesky(h.ctx).catch((e) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error).toMatchObject({ code: "access_expired", reconnect: true });
  });
});

describe("Bluesky helpers", () => {
  it("marks facets by UTF-8 byte offsets", async () => {
    const text = "é #tag";
    const [facet] = await facetsFor(text, async () => null);
    expect(facet.index).toEqual({ byteStart: 3, byteEnd: 7 });
    expect(await facetsFor("hi @nobody.example.com", async () => null)).toEqual([]);
    expect(await facetsFor("see https://a.example/x. ok", async () => null)).toMatchObject([{ features: [{ uri: "https://a.example/x" }] }]);
  });

  it("makes 13-character time-sortable record keys", () => {
    const a = newTid(Date.parse("2026-10-10T12:00:00Z"), 1);
    const b = newTid(Date.parse("2026-10-10T12:00:01Z"), 1);
    expect(a).toMatch(/^[2-7a-z]{13}$/);
    expect(a < b).toBe(true);
  });

  it("shrinks images over 1 MB and leaves smaller ones alone", async () => {
    const sharp = (await import("sharp")).default;
    const noisy = Buffer.alloc(1600 * 1600 * 3);
    for (let i = 0; i < noisy.length; i += 65536) crypto.getRandomValues(noisy.subarray(i, i + 65536));
    const big = new Uint8Array(await sharp(noisy, { raw: { width: 1600, height: 1600, channels: 3 } }).png().toBuffer());
    expect(big.length).toBeGreaterThan(MAX_IMAGE_BYTES);
    const fitted = await fitImage(big, "image/png");
    expect(fitted.type).toBe("image/jpeg");
    expect(fitted.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    const small = new Uint8Array(10);
    expect((await fitImage(small, "image/png")).bytes).toBe(small);
  });
});
