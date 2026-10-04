// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DestinationOptions } from "../../../backend/lib/publishing/validate";
import { publishFacebook } from "./facebook";
import { publishInstagram, publishThreads } from "./meta";
import { chunkPlan, publishTikTok } from "./tiktok";
import { PublishError, type Bundle, type Checkpoint, type StepContext } from "./types";
import { publishYouTube } from "./youtube";

type Route = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

function harness(platform: Bundle["platform"], options: DestinationOptions, routes: Route[], opts: { checkpoint?: Checkpoint; media?: Partial<Bundle["media"][number]>[] } = {}) {
  const calls: string[] = [];
  const checkpoint: Checkpoint = { ...(opts.checkpoint ?? {}) };
  const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(`${init.method ?? "GET"} ${url.origin}${url.pathname}`);
    for (const route of routes) {
      const response = await route(url, init);
      if (response) return response;
    }
    throw new Error(`no stand-in for ${init.method ?? "GET"} ${url}`);
  }) as typeof fetch;
  const ctx: StepContext = {
    bundle: {
      jobId: "j", workspaceId: "w", postId: "p", destinationId: "d", platform, options, caption: "Hello world",
      account: { id: "a", externalId: "acct-1", handle: "aki", displayName: "Aki", scopes: ["video.upload"], capabilities: {} },
      media: (opts.media ?? [{}]).map((m, i) => ({
        id: `m${i}`, name: `f${i}`, status: "ready", media_type: "image", mime_type: "image/jpeg", size_bytes: 1000, width: 1080, height: 1920,
        duration_seconds: null, storage_key: `k${i}`, url: `https://r2.example/f${i}?sig=1`, ...m,
      })),
    },
    checkpoint,
    save: async (patch) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete checkpoint[k];
        else checkpoint[k] = v;
      }
    },
    token: async () => "tok",
    http,
    reserve: async () => undefined,
    renewLease: async () => undefined,
    now: () => Date.parse("2026-10-05T12:00:00Z"),
    sleep: async () => undefined,
  };
  return { ctx, calls, checkpoint };
}

const method = (init: RequestInit) => init.method ?? "GET";

describe("Instagram", () => {
  it("creates a container, waits for it, publishes once and returns the permalink", async () => {
    let status = "IN_PROGRESS";
    const h = harness("instagram", { kind: "instagram", media_type: "reel" }, [
      (u, i) => (method(i) === "POST" && u.pathname.endsWith("/acct-1/media") ? json({ id: "c1" }) : undefined),
      (u) => (u.pathname.endsWith("/c1") ? json({ status_code: status }) : undefined),
      (u, i) => (method(i) === "POST" && u.pathname.endsWith("/media_publish") ? json({ id: "ig-post" }) : undefined),
      (u) => (u.pathname.endsWith("/ig-post") ? json({ permalink: "https://instagram.com/p/x" }) : undefined),
    ], { media: [{ media_type: "video", mime_type: "video/mp4", duration_seconds: 10 }] });

    expect(await publishInstagram(h.ctx)).toMatchObject({ kind: "wait" });
    status = "FINISHED";
    expect(await publishInstagram(h.ctx)).toEqual({ kind: "published", platformId: "ig-post", liveUrl: "https://instagram.com/p/x" });
    expect(h.calls.filter((c) => c.includes("media_publish"))).toHaveLength(1);
    expect(h.calls.filter((c) => c === "POST https://graph.instagram.com/v25.0/acct-1/media")).toHaveLength(1);
  });

  it("after a crash right after publishing, finds the post instead of publishing again", async () => {
    const h = harness("instagram", { kind: "instagram", media_type: "image" }, [
      (u) => (u.pathname.endsWith("/c1") ? json({ status_code: "PUBLISHED" }) : undefined),
      (u, i) => (method(i) === "GET" && u.pathname.endsWith("/acct-1/media") ? json({ data: [{ id: "ig-9", permalink: "https://instagram.com/p/9", timestamp: "2026-10-05T12:00:05+0000" }] }) : undefined),
    ], { checkpoint: { container_id: "c1", publish_started_at: "2026-10-05T12:00:00Z" } });
    expect(await publishInstagram(h.ctx)).toMatchObject({ kind: "published", platformId: "ig-9", liveUrl: "https://instagram.com/p/9" });
    expect(h.calls.some((c) => c.includes("media_publish"))).toBe(false);
  });

  it("builds carousels child by child and resumes from the saved children", async () => {
    let n = 0;
    const h = harness("instagram", { kind: "instagram", media_type: "carousel" }, [
      (u, i) => {
        if (method(i) !== "POST" || !u.pathname.endsWith("/acct-1/media")) return undefined;
        const body = new URLSearchParams(String(i.body));
        return json({ id: body.get("media_type") === "CAROUSEL" ? "parent" : `child-${++n}` });
      },
      (u) => (/child-|parent/.test(u.pathname) ? json({ status_code: "FINISHED" }) : undefined),
      (u, i) => (method(i) === "POST" && u.pathname.endsWith("/media_publish") ? json({ id: "ig-c" }) : undefined),
      (u) => (u.pathname.endsWith("/ig-c") ? json({ permalink: "https://instagram.com/p/c" }) : undefined),
    ], { media: [{}, {}, {}], checkpoint: { children: ["child-0"] } });
    expect(await publishInstagram(h.ctx)).toMatchObject({ kind: "published", platformId: "ig-c" });
    expect(h.checkpoint.children).toEqual(["child-0", "child-1", "child-2"]);
  });

  it("explains a container that failed to process", async () => {
    const h = harness("instagram", { kind: "instagram", media_type: "image" }, [
      (u) => (u.pathname.endsWith("/c1") ? json({ status_code: "ERROR", status: "Image aspect ratio unsupported" }) : undefined),
    ], { checkpoint: { container_id: "c1" } });
    await expect(publishInstagram(h.ctx)).rejects.toThrow("Instagram could not process the media: Image aspect ratio unsupported.");
  });
});

describe("Threads", () => {
  it("publishes a text post", async () => {
    const h = harness("threads", { kind: "threads", media_type: "text" }, [
      (u, i) => (method(i) === "POST" && u.pathname.endsWith("/acct-1/threads") ? json({ id: "t1" }) : undefined),
      (u) => (u.pathname.endsWith("/t1") ? json({ status: "FINISHED" }) : undefined),
      (u, i) => (method(i) === "POST" && u.pathname.endsWith("/threads_publish") ? json({ id: "th-1" }) : undefined),
      (u) => (u.pathname.endsWith("/th-1") ? json({ permalink: "https://threads.net/@aki/post/1" }) : undefined),
    ], { media: [] });
    expect(await publishThreads(h.ctx)).toEqual({ kind: "published", platformId: "th-1", liveUrl: "https://threads.net/@aki/post/1" });
  });
});

describe("Facebook", () => {
  it("posts text once and returns the post link", async () => {
    const h = harness("facebook", { kind: "facebook", media_type: "text" }, [
      (u, i) => (method(i) === "POST" && u.pathname.endsWith("/acct-1/feed") ? json({ id: "page_1" }) : undefined),
    ], { media: [] });
    expect(await publishFacebook(h.ctx)).toEqual({ kind: "published", platformId: "page_1", liveUrl: "https://www.facebook.com/page_1" });
  });

  it("after a crash during posting, finds the post on the Page instead of posting again", async () => {
    const h = harness("facebook", { kind: "facebook", media_type: "text" }, [
      (u, i) => (method(i) === "GET" && u.pathname.endsWith("/acct-1/feed") ? json({ data: [{ id: "page_7", message: "Hello world" }] }) : undefined),
    ], { media: [], checkpoint: { publish_started_at: "2026-10-05T12:00:00Z" } });
    expect(await publishFacebook(h.ctx)).toMatchObject({ kind: "published", platformId: "page_7" });
    expect(h.calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("keeps looking for an interrupted post for two minutes before posting again", async () => {
    let feed: Array<{ id: string; message: string }> = [];
    const h = harness("facebook", { kind: "facebook", media_type: "text" }, [
      (u, i) => (method(i) === "GET" && u.pathname.endsWith("/acct-1/feed") ? json({ data: feed }) : undefined),
    ], { media: [], checkpoint: { publish_started_at: "2026-10-05T11:59:30Z" } });
    expect(await publishFacebook(h.ctx)).toMatchObject({ kind: "wait" });
    feed = [{ id: "page_8", message: "Hello world" }];
    expect(await publishFacebook(h.ctx)).toMatchObject({ kind: "published", platformId: "page_8" });
    expect(h.calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("publishes a Reel: start, upload by URL, finish, then waits until ready", async () => {
    let ready = false;
    const h = harness("facebook", { kind: "facebook", media_type: "reel" }, [
      (u, i) => {
        if (method(i) !== "POST" || !u.pathname.endsWith("/acct-1/video_reels")) return undefined;
        return new URLSearchParams(String(i.body)).get("upload_phase") === "start" ? json({ video_id: "v1" }) : json({ success: true });
      },
      (u, i) => (u.host === "rupload.facebook.com" && (i.headers as Record<string, string>).file_url ? json({ success: true }) : undefined),
      (u) => (u.pathname.endsWith("/v1") ? json({ status: { video_status: ready ? "ready" : "processing", publishing_phase: { status: ready ? "complete" : "in_progress" } } }) : undefined),
    ], { media: [{ media_type: "video", mime_type: "video/mp4" }] });
    expect(await publishFacebook(h.ctx)).toMatchObject({ kind: "wait" });
    ready = true;
    expect(await publishFacebook(h.ctx)).toEqual({ kind: "published", platformId: "v1", liveUrl: "https://www.facebook.com/reel/v1" });
    expect(h.calls.filter((c) => c.includes("video_reels"))).toHaveLength(2); // start + finish, each once
  });

  it("asks the person to reconnect when the token is rejected", async () => {
    const h = harness("facebook", { kind: "facebook", media_type: "text" }, [
      () => json({ error: { code: 190, message: "Session expired" } }, 400),
    ], { media: [] });
    const error = (await publishFacebook(h.ctx).catch((e) => e)) as PublishError;
    expect(error).toBeInstanceOf(PublishError);
    expect(error).toMatchObject({ code: "access_expired", reconnect: true, retryable: false });
  });
});

describe("YouTube", () => {
  const video = { media_type: "video" as const, mime_type: "video/mp4", size_bytes: 1000, duration_seconds: 20 };

  it("starts a resumable upload, sends the file and returns the Short", async () => {
    const h = harness("youtube", { kind: "youtube", title: "Launch", privacy_status: "private" }, [
      (u, i) => (u.pathname === "/upload/youtube/v3/videos" ? (JSON.parse(String(i.body)).snippet.title === "Launch #Shorts" ? new Response(null, { status: 200, headers: { location: "https://up.example/s1" } }) : undefined) : undefined),
      (u, i) => (u.host === "up.example" && (i.headers as Record<string, string>)["Content-Range"] === "bytes */1000" ? new Response(null, { status: 308 }) : undefined),
      (u) => (u.host === "r2.example" ? new Response(new Uint8Array(1000), { status: 206 }) : undefined),
      (u, i) => (u.host === "up.example" && method(i) === "PUT" ? json({ id: "yt-1" }, 201) : undefined),
    ], { media: [video] });
    expect(await publishYouTube(h.ctx)).toEqual({ kind: "published", platformId: "yt-1", liveUrl: "https://www.youtube.com/shorts/yt-1" });
  });

  it("does not upload again when the previous run already finished", async () => {
    const h = harness("youtube", { kind: "youtube", title: "Launch", privacy_status: "private" }, [
      (u) => (u.host === "up.example" ? json({ id: "yt-2" }, 200) : undefined),
    ], { media: [video], checkpoint: { upload_url: "https://up.example/s1", publish_started_at: "x" } });
    expect(await publishYouTube(h.ctx)).toMatchObject({ kind: "published", platformId: "yt-2" });
    expect(h.calls).toEqual(["PUT https://up.example/s1"]);
  });

  it("waits until the daily quota resets", async () => {
    const h = harness("youtube", { kind: "youtube", title: "Launch", privacy_status: "private" }, [
      () => new Response('{"error":{"errors":[{"reason":"quotaExceeded"}]}}', { status: 403 }),
    ], { media: [video] });
    const error = (await publishYouTube(h.ctx).catch((e) => e)) as PublishError;
    expect(error).toMatchObject({ code: "youtube_quota", retryable: true });
    expect(error.retryAt!.getTime()).toBeGreaterThan(Date.parse("2026-10-05T12:00:00Z"));
  });
});

describe("TikTok", () => {
  const video = { media_type: "video" as const, mime_type: "video/mp4", size_bytes: 3000, duration_seconds: 20 };
  const direct: DestinationOptions = { kind: "tiktok", delivery_mode: "direct", privacy_level: "SELF_ONLY" };

  it("checks the creator, uploads in chunks, then polls until published", async () => {
    let status = "PROCESSING_DOWNLOAD";
    const h = harness("tiktok", direct, [
      (u) => (u.pathname.endsWith("/creator_info/query/") ? json({ data: { can_post: true, privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } }) : undefined),
      (u, i) => (u.pathname.endsWith("/video/init/") ? (JSON.parse(String(i.body)).post_info.disable_comment === true ? json({ data: { publish_id: "pub-1", upload_url: "https://upload.tiktok.example/u" }, error: { code: "ok" } }) : undefined) : undefined),
      (u) => (u.host === "r2.example" ? new Response(new Uint8Array(3000), { status: 206 }) : undefined),
      (u) => (u.host === "upload.tiktok.example" ? new Response(null, { status: 201 }) : undefined),
      (u) => (u.pathname.endsWith("/status/fetch/") ? json({ data: { status, publicaly_available_post_id: status === "PUBLISH_COMPLETE" ? ["777"] : [] }, error: { code: "ok" } }) : undefined),
    ], { media: [video] });
    expect(await publishTikTok(h.ctx)).toMatchObject({ kind: "wait" });
    expect(await publishTikTok(h.ctx)).toMatchObject({ kind: "wait" });
    status = "PUBLISH_COMPLETE";
    expect(await publishTikTok(h.ctx)).toEqual({ kind: "published", platformId: "777", liveUrl: "https://www.tiktok.com/@aki/video/777", note: undefined });
    expect(h.calls.filter((c) => c.includes("/video/init/"))).toHaveLength(1);
  });

  it("refuses an audience the account does not allow", async () => {
    const h = harness("tiktok", { ...direct, privacy_level: "PUBLIC_TO_EVERYONE" }, [
      (u) => (u.pathname.endsWith("/creator_info/query/") ? json({ data: { can_post: true, privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }) : undefined),
    ], { media: [video] });
    await expect(publishTikTok(h.ctx)).rejects.toThrow("This TikTok account can't post with that audience. Choose one of: SELF_ONLY.");
  });

  it("explains TikTok's pre-audit private-accounts rule in plain language", async () => {
    const h = harness("tiktok", direct, [
      (u) => (u.pathname.endsWith("/creator_info/query/") ? json({ data: { can_post: true, privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }) : undefined),
      (u) => (u.pathname.endsWith("/video/init/") ? json({ error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "Please review our integration guidelines" } }, 403) : undefined),
    ], { media: [video] });
    const error = (await publishTikTok(h.ctx).catch((e) => e)) as PublishError;
    expect(error).toMatchObject({ code: "unaudited_client_can_only_post_to_private_accounts", retryable: false });
    expect(error.message).toMatch(/can only post to TikTok accounts set to Private/);
  });

  it("splits large videos into chunks of at most 64 MB", () => {
    const plan = chunkPlan(150 * 1024 * 1024);
    expect(plan.ranges).toHaveLength(3);
    expect(plan.ranges.at(-1)!.end).toBe(150 * 1024 * 1024 - 1);
  });
});
