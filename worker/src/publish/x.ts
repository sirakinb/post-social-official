// X posts: text, up to 4 images (or one GIF), or one video. Media goes up in parts through
// the v2 media upload, read from storage a piece at a time, and every finished upload is
// saved so a retry carries on where it stopped. Videos and GIFs are processed by X before
// they can be posted. X has no way to make a post idempotent and reading the timeline back
// costs money, so, like LinkedIn, an interrupted post is reported rather than repeated.
//
// Every post is billed to Post Social's X developer account (about 1.5 cents, or 20 cents
// when the text has a link).
import { captionFor, linkedinMediaType, type LinkedInOptions, type XOptions } from "../../../backend/lib/publishing/validate";
import { PublishError, type Adapter, type PublishMedia, type StepContext } from "./types";

const API = "https://api.x.com/2";
const PART_BYTES = 4 * 1024 * 1024;
// X's per-user posting limit is generous; this guards against runaway loops.
const POSTS_PER_DAY = 300;

async function failure(response: Response, what: string): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { title?: string; detail?: string; errors?: Array<{ message?: string }>; type?: string };
  const detail = body.detail ?? body.errors?.[0]?.message ?? body.title;
  if (response.status === 401) throw new PublishError("access_expired", `${what} was refused because the X access expired. Reconnect X and try again.`, false, undefined, true);
  if (response.status === 402 || /credits|payment|spend/i.test(detail ?? "")) {
    throw new PublishError("x_no_credits", `X refused the post because Post Social's X credits ran out${detail ? ` (X said: ${detail})` : ""}. Add credits in the X Developer Console, then retry.`, false);
  }
  if (response.status === 429) throw new PublishError("x_rate_limited", "X's posting limit for this account is used up for now. Post Social will try again later.", true);
  if (response.status === 403) throw new PublishError("x_forbidden", `${what} was refused by X${detail ? `: ${detail}` : ""}.`, false);
  throw new PublishError(`http_${response.status}`, `${what} failed${detail ? `: ${detail}` : ` (${response.status})`}.`, response.status >= 500);
}

async function call(ctx: StepContext, method: "GET" | "POST", path: string, what: string, body?: BodyInit, json = true) {
  const response = await ctx.http(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await ctx.token()}`, ...(json && body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body,
  });
  if (!response.ok) await failure(response, what);
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function readStored(ctx: StepContext, url: string, start: number, end: number) {
  const source = await ctx.http(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!(source.ok || source.status === 206)) throw new PublishError("media_unavailable", "The stored media could not be read.", true);
  return new Uint8Array(await source.arrayBuffer());
}

const category = (m: PublishMedia) => (m.media_type === "video" ? "tweet_video" : m.mime_type === "image/gif" ? "tweet_gif" : "tweet_image");

type Upload = { id: string; parts: number; done: boolean };

// Uploads one file in parts. Returns the media id once X has finished with it, or null
// while it is still processing.
async function upload(ctx: StepContext, index: number): Promise<string | null> {
  const item = ctx.bundle.media[index];
  const uploads = ((ctx.checkpoint.uploads as Upload[] | undefined) ?? []).slice();
  let current = uploads[index];
  if (!current) {
    const init = await call(ctx, "POST", "/media/upload/initialize", "Starting the X upload", JSON.stringify({ media_type: item.mime_type, total_bytes: item.size_bytes, media_category: category(item) }));
    if (!init.data?.id) throw new PublishError("x_no_upload", "X did not start the upload.", true);
    // Nothing is posted until the post itself, so a lost upload is simply redone.
    current = { id: String(init.data.id), parts: 0, done: false };
    uploads[index] = current;
    await ctx.save({ uploads });
  }
  const total = Math.ceil(item.size_bytes / PART_BYTES);
  while (current.parts < total) {
    const start = current.parts * PART_BYTES;
    const bytes = await readStored(ctx, item.url, start, Math.min(item.size_bytes, start + PART_BYTES) - 1);
    const form = new FormData();
    form.set("segment_index", String(current.parts));
    form.set("media", new Blob([bytes], { type: "application/octet-stream" }));
    await call(ctx, "POST", `/media/upload/${current.id}/append`, "Uploading to X", form, false);
    current.parts++;
    await ctx.save({ uploads });
    await ctx.renewLease();
  }

  if (!current.done) {
    const finished = await call(ctx, "POST", `/media/upload/${current.id}/finalize`, "Finishing the X upload");
    current.done = true;
    await ctx.save({ uploads });
    if (!finished.data?.processing_info) return current.id;
  }
  // Videos and GIFs are processed; images are ready once finished.
  if (item.media_type === "image" && item.mime_type !== "image/gif") return current.id;
  const status = await call(ctx, "GET", `/media/upload?command=STATUS&media_id=${encodeURIComponent(current.id)}`, "Checking the X upload");
  const info = status.data?.processing_info;
  if (!info || info.state === "succeeded") return current.id;
  if (info.state === "failed") throw new PublishError("video_processing_failed", `X could not process ${item.name}${info.error?.message ? `: ${info.error.message}` : ""}.`);
  return null;
}

export const publishX: Adapter = async (ctx) => {
  const options = ctx.bundle.options as XOptions;
  const handle = ctx.bundle.account.handle;
  const liveUrl = (id: string) => `https://x.com/${encodeURIComponent(handle)}/status/${id}`;

  if (ctx.checkpoint.post_id) return { kind: "published", platformId: String(ctx.checkpoint.post_id), liveUrl: liveUrl(String(ctx.checkpoint.post_id)) };
  if (ctx.checkpoint.publish_started_at) {
    throw new PublishError("unconfirmed", "Posting to X was interrupted. Check the X profile before posting it again.");
  }

  const type = linkedinMediaType(options as unknown as LinkedInOptions, ctx.bundle.media);
  const mediaIds: string[] = [];
  if (type !== "text") {
    for (let i = 0; i < ctx.bundle.media.length; i++) {
      const id = await upload(ctx, i);
      if (!id) return { kind: "wait", afterMs: 10_000, message: "X is processing the media." };
      mediaIds.push(id);
    }
    // Image descriptions (alt text).
    const described = ((ctx.checkpoint.described as number[] | undefined) ?? []).slice();
    for (const [i, alt] of (options.alt_text ?? []).entries()) {
      if (!alt.trim() || described.includes(i) || !mediaIds[i]) continue;
      await call(ctx, "POST", "/media/metadata", "Adding the image description on X", JSON.stringify({ id: mediaIds[i], metadata: { alt_text: { text: alt.slice(0, 1000) } } }));
      described.push(i);
      await ctx.save({ described });
    }
  }

  await ctx.reserve("x_post", POSTS_PER_DAY, 24 * 3600);
  await ctx.save({ publish_started_at: new Date(ctx.now()).toISOString() });
  const text = captionFor(options, ctx.bundle.caption).trim();
  let created: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    created = await call(ctx, "POST", "/tweets", "Posting to X", JSON.stringify({ ...(text ? { text } : {}), ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }));
  } catch (error) {
    // X answered with a refusal, so nothing was posted and a retry is safe. (A lost
    // connection leaves publish_started_at set and is reported instead.)
    if (error instanceof PublishError) await ctx.save({ publish_started_at: null });
    throw error;
  }
  const id = created.data?.id ? String(created.data.id) : null;
  if (!id) return { kind: "published", note: "X accepted the post but didn't return its address." };
  await ctx.save({ post_id: id });
  return { kind: "published", platformId: id, liveUrl: liveUrl(id) };
};
