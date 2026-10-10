// Bluesky posts: text, up to 4 images, or one video. Calls go to the account's own server
// (PDS) with its DPoP-bound access. Images are uploaded as blobs (resized to Bluesky's 1 MB
// limit when needed); videos go through Bluesky's video service, which processes them
// before they can be posted. The post's record key is chosen and saved before it is sent,
// so an interrupted post is looked up instead of being posted twice.
import { pdsFetch, resolveHandle, type BlueskySession } from "../../../backend/lib/connections/atproto";
import { captionFor, linkedinMediaType, type BlueskyOptions, type LinkedInOptions } from "../../../backend/lib/publishing/validate";
import { PublishError, type Adapter, type PublishMedia, type StepContext } from "./types";

export const MAX_IMAGE_BYTES = 1_000_000;
const VIDEO_SERVICE = "https://video.bsky.app";
// Bluesky's daily video upload allowance is per account; its posting limits are generous
// (about 1,600 record writes an hour), so this only guards against runaway loops.
const POSTS_PER_HOUR = 300;

type Blob = { $type: "blob"; ref: { $link: string }; mimeType: string; size: number };

async function failure(response: Response, what: string): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  const detail = body.message ?? body.error;
  if (response.status === 401 || body.error === "invalid_token" || body.error === "ExpiredToken") {
    throw new PublishError("access_expired", `${what} was refused because the Bluesky access expired. Reconnect Bluesky and try again.`, false, undefined, true);
  }
  if (response.status === 429) throw new PublishError("bluesky_rate_limited", "Bluesky's limit for this account is used up for now. Post Social will try again later.", true);
  throw new PublishError(body.error ? `bluesky_${body.error}` : `http_${response.status}`, `${what} failed${detail ? `: ${detail}` : ` (${response.status})`}.`, response.status >= 500);
}

async function session(ctx: StepContext) {
  if (!ctx.session) throw new PublishError("credential_missing", "The Bluesky session could not be loaded.");
  return (await ctx.session()) as unknown as BlueskySession;
}

async function xrpc(ctx: StepContext, method: "GET" | "POST", nsid: string, what: string, options: { query?: Record<string, string>; json?: unknown; bytes?: Uint8Array<ArrayBuffer>; type?: string } = {}) {
  const s = await session(ctx);
  const url = new URL(`${s.pds}/xrpc/${nsid}`);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.bytes) {
    headers["Content-Type"] = options.type ?? "application/octet-stream";
    body = options.bytes;
  }
  const { response } = await pdsFetch(ctx.http, s, url.toString(), { method, headers, body });
  return response;
}

async function readStored(ctx: StepContext, url: string) {
  const source = await ctx.http(url);
  if (!source.ok) throw new PublishError("media_unavailable", "The stored media could not be read.", true);
  return new Uint8Array(await source.arrayBuffer());
}

// Phone photos are often over Bluesky's 1 MB limit; those are re-encoded as JPEG, shrinking
// until they fit.
export async function fitImage(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  if (bytes.length <= MAX_IMAGE_BYTES) return { bytes, type };
  const sharp = (await import("sharp")).default;
  for (const [edge, quality] of [[2000, 85], [1600, 80], [1280, 75], [1000, 70], [800, 65]] as const) {
    const out = await sharp(bytes).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= MAX_IMAGE_BYTES) return { bytes: new Uint8Array(out), type: "image/jpeg" };
  }
  throw new PublishError("image_too_large", "One of the images could not be made small enough for Bluesky (1 MB).");
}

async function uploadImages(ctx: StepContext): Promise<Blob[]> {
  const blobs = ((ctx.checkpoint.blobs as Blob[] | undefined) ?? []).slice();
  for (let i = blobs.length; i < ctx.bundle.media.length; i++) {
    const item = ctx.bundle.media[i];
    const { bytes, type } = await fitImage(await readStored(ctx, item.url), item.mime_type);
    const response = await xrpc(ctx, "POST", "com.atproto.repo.uploadBlob", "Uploading the image to Bluesky", { bytes, type });
    if (!response.ok) await failure(response, "Uploading the image to Bluesky");
    const { blob } = (await response.json()) as { blob: Blob };
    blobs.push(blob);
    await ctx.save({ blobs });
    await ctx.renewLease();
  }
  return blobs;
}

const aspect = (m: PublishMedia) => (m.width && m.height ? { aspectRatio: { width: m.width, height: m.height } } : {});

// Videos are sent to Bluesky's video service with a short-lived token from the account's
// server, then processed; the finished blob is what the post embeds.
async function uploadVideo(ctx: StepContext): Promise<Blob | null> {
  if (ctx.checkpoint.video_blob) return ctx.checkpoint.video_blob as Blob;
  const s = await session(ctx);
  if (!ctx.checkpoint.video_job) {
    const auth = await xrpc(ctx, "GET", "com.atproto.server.getServiceAuth", "Getting Bluesky's video permission", {
      query: { aud: `did:web:${new URL(s.pds).hostname}`, lxm: "com.atproto.repo.uploadBlob", exp: String(Math.floor(ctx.now() / 1000) + 30 * 60) },
    });
    if (!auth.ok) await failure(auth, "Getting Bluesky's video permission");
    const { token } = (await auth.json()) as { token: string };
    const video = ctx.bundle.media[0];
    const url = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo`);
    url.searchParams.set("did", s.did);
    url.searchParams.set("name", `${ctx.bundle.destinationId}.mp4`);
    const response = await ctx.http(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4" },
      body: await readStored(ctx, video.url),
    });
    const body = (await response.json().catch(() => ({}))) as { jobId?: string; jobStatus?: { jobId?: string }; error?: string; message?: string };
    // The same video uploaded before is already being (or was) processed.
    const jobId = body.jobId ?? body.jobStatus?.jobId;
    if (!jobId) {
      if (response.status === 429) throw new PublishError("bluesky_video_limit", "This Bluesky account has reached its daily video upload limit. Post Social will try again later.", true);
      throw new PublishError(body.error ? `bluesky_${body.error}` : `http_${response.status}`, `Uploading the video to Bluesky failed${body.message ? `: ${body.message}` : ` (${response.status})`}.`, response.status >= 500);
    }
    await ctx.save({ video_job: jobId });
    await ctx.renewLease();
  }

  const status = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus`);
  status.searchParams.set("jobId", String(ctx.checkpoint.video_job));
  const response = await ctx.http(status);
  if (!response.ok) await failure(response, "Checking the Bluesky video");
  const { jobStatus } = (await response.json()) as { jobStatus: { state: string; blob?: Blob; error?: string; message?: string } };
  if (jobStatus.state === "JOB_STATE_FAILED") throw new PublishError("video_processing_failed", `Bluesky could not process the video${jobStatus.message ? `: ${jobStatus.message}` : ""}.`);
  if (jobStatus.state !== "JOB_STATE_COMPLETED" || !jobStatus.blob) return null;
  await ctx.save({ video_blob: jobStatus.blob });
  return jobStatus.blob;
}

// ---------- Text ----------

type Facet = { index: { byteStart: number; byteEnd: number }; features: Array<Record<string, string>> };

const bytesBefore = (text: string, index: number) => new TextEncoder().encode(text.slice(0, index)).length;

// Links, @mentions and #hashtags, marked with byte offsets the way Bluesky expects.
// Mentions that don't resolve to an account stay plain text.
export async function facetsFor(text: string, resolve: (handle: string) => Promise<string | null>): Promise<Facet[]> {
  const facets: Facet[] = [];
  const add = (start: number, end: number, feature: Record<string, string>) =>
    facets.push({ index: { byteStart: bytesBefore(text, start), byteEnd: bytesBefore(text, end) }, features: [feature] });

  for (const match of text.matchAll(/(^|[\s(])(https?:\/\/[^\s<>"]+)/g)) {
    const url = match[2].replace(/[.,;:!?)]+$/, "");
    const start = match.index! + match[1].length;
    add(start, start + url.length, { $type: "app.bsky.richtext.facet#link", uri: url });
  }
  for (const match of text.matchAll(/(^|[\s(])@(([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9])/gi)) {
    const did = await resolve(match[2].toLowerCase());
    if (!did) continue;
    const start = match.index! + match[1].length;
    add(start, start + 1 + match[2].length, { $type: "app.bsky.richtext.facet#mention", did });
  }
  for (const match of text.matchAll(/(^|\s)[#＃]([^\s#＃]+)/gu)) {
    const tag = match[2].replace(/\p{P}+$/u, "");
    if (!tag || tag.length > 64 || /^\d+$/.test(tag)) continue;
    const start = match.index! + match[1].length;
    add(start, start + 1 + tag.length, { $type: "app.bsky.richtext.facet#tag", tag });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

// A record key in Bluesky's time-based format (TID): 13 characters, sortable by time.
export function newTid(nowMs: number, clock = Math.floor(Math.random() * 1024)) {
  const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
  let value = (BigInt(nowMs) * 1000n) << 10n | BigInt(clock & 1023);
  let out = "";
  for (let i = 0; i < 13; i++) {
    out = alphabet[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

export const publishBluesky: Adapter = async (ctx) => {
  const options = ctx.bundle.options as BlueskyOptions;
  const handle = ctx.bundle.account.handle || ctx.bundle.account.externalId;
  const liveUrl = (rkey: string) => `https://bsky.app/profile/${handle}/post/${rkey}`;

  if (ctx.checkpoint.post_uri) {
    const rkey = String(ctx.checkpoint.rkey);
    return { kind: "published", platformId: String(ctx.checkpoint.post_uri), liveUrl: liveUrl(rkey) };
  }

  const s = await session(ctx);
  // A post that was sent but not confirmed: look for it under the key it was sent with.
  if (ctx.checkpoint.publish_started_at && ctx.checkpoint.rkey) {
    const existing = await xrpc(ctx, "GET", "com.atproto.repo.getRecord", "Checking the Bluesky post", {
      query: { repo: s.did, collection: "app.bsky.feed.post", rkey: String(ctx.checkpoint.rkey) },
    });
    if (existing.ok) {
      const { uri } = (await existing.json()) as { uri: string };
      await ctx.save({ post_uri: uri });
      return { kind: "published", platformId: uri, liveUrl: liveUrl(String(ctx.checkpoint.rkey)) };
    }
  }

  const type = linkedinMediaType(options as unknown as LinkedInOptions, ctx.bundle.media);
  let embed: Record<string, unknown> | undefined;
  if (type === "image") {
    const blobs = await uploadImages(ctx);
    embed = {
      $type: "app.bsky.embed.images",
      images: blobs.map((image, i) => ({ image, alt: (options.alt_text?.[i] ?? "").slice(0, 2000), ...aspect(ctx.bundle.media[i]) })),
    };
  } else if (type === "video") {
    const blob = await uploadVideo(ctx);
    if (!blob) return { kind: "wait", afterMs: 10_000, message: "Bluesky is processing the video." };
    embed = { $type: "app.bsky.embed.video", video: blob, ...aspect(ctx.bundle.media[0]) };
  }

  const text = captionFor(options, ctx.bundle.caption).trim();
  const facets = await facetsFor(text, (h) => resolveHandle(ctx.http, h).catch(() => null));
  await ctx.reserve("bluesky_post", POSTS_PER_HOUR, 3600);
  const rkey = (ctx.checkpoint.rkey as string | undefined) ?? newTid(ctx.now());
  await ctx.save({ rkey, publish_started_at: new Date(ctx.now()).toISOString() });
  const response = await xrpc(ctx, "POST", "com.atproto.repo.createRecord", "Posting to Bluesky", {
    json: {
      repo: s.did,
      collection: "app.bsky.feed.post",
      rkey,
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date(ctx.now()).toISOString(),
        ...(facets.length ? { facets } : {}),
        ...(embed ? { embed } : {}),
      },
    },
  });
  if (!response.ok) await failure(response, "Posting to Bluesky");
  const { uri } = (await response.json()) as { uri: string };
  await ctx.save({ post_uri: uri });
  return { kind: "published", platformId: uri, liveUrl: liveUrl(rkey) };
};
