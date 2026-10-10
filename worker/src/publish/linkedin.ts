// LinkedIn member posts (Share on LinkedIn): text, images (2 to 20 show as a gallery) and
// videos. Media is uploaded first: images one by one, videos in the parts LinkedIn asks
// for, streamed from storage. Every finished upload is saved, so a retry carries on where
// it stopped. The post itself is a single call; its start is saved first, and since this
// permission can't read posts back, an interrupted post is reported rather than repeated.
import { captionFor, linkedinMediaType, type CoverOptions, type LinkedInOptions } from "../../../backend/lib/publishing/validate";
import { PublishError, type Adapter, type StepContext } from "./types";

const API = "https://api.linkedin.com/rest";
// LinkedIn's API versions (YYYYMM) are supported for about a year.
const VERSION = "202609";
// LinkedIn limits how much one member can post in a day.
const POSTS_PER_DAY = 150;

type Part = { uploadUrl: string; firstByte: number; lastByte: number };

async function failure(response: Response, what: string): Promise<never> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep empty
  }
  if (response.status === 401) throw new PublishError("access_expired", `${what} was refused because the LinkedIn access expired. Reconnect LinkedIn and try again.`, false, undefined, true);
  const message = typeof body.message === "string" ? body.message : undefined;
  if (response.status === 403) throw new PublishError("linkedin_forbidden", `${what} was refused by LinkedIn${message ? `: ${message}` : ""}. Reconnect LinkedIn to grant posting access.`, false, undefined, true);
  if (response.status === 429) throw new PublishError("linkedin_rate_limited", "LinkedIn's posting limit for this account is used up for now. Post Social will try again later.", true);
  throw new PublishError(`http_${response.status}`, `${what} failed${message ? `: ${message}` : ` (${response.status})`}.`, response.status >= 500);
}

async function rest(ctx: StepContext, method: "GET" | "POST", path: string, body: unknown, what: string) {
  const response = await ctx.http(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await ctx.token()}`,
      "LinkedIn-Version": VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) await failure(response, what);
  return response;
}

async function restJson(ctx: StepContext, method: "GET" | "POST", path: string, body: unknown, what: string) {
  const text = await (await rest(ctx, method, path, body, what)).text();
  return (text ? JSON.parse(text) : {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// Upload addresses come from LinkedIn; the account's token only ever goes to LinkedIn.
function linkedinUploadUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !(parsed.hostname === "linkedin.com" || parsed.hostname.endsWith(".linkedin.com"))) {
    throw new PublishError("linkedin_bad_upload_url", "LinkedIn returned an unexpected upload address.");
  }
  return parsed.toString();
}

async function put(ctx: StepContext, url: string, bytes: Uint8Array<ArrayBuffer>, what: string, headers: Record<string, string> = {}) {
  const response = await ctx.http(linkedinUploadUrl(url), {
    method: "PUT",
    headers: { Authorization: `Bearer ${await ctx.token()}`, "Content-Type": "application/octet-stream", ...headers },
    body: bytes,
  });
  if (!response.ok) await failure(response, what);
  return response;
}

async function readStored(ctx: StepContext, url: string, range?: { start: number; end: number }) {
  const source = await ctx.http(url, range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : undefined);
  if (!(source.ok || source.status === 206)) throw new PublishError("media_unavailable", "The stored media could not be read.", true);
  return new Uint8Array(await source.arrayBuffer());
}

// LinkedIn reads post text as its "little text" format: these characters must be escaped or
// the post is cut short. Hashtags become LinkedIn hashtags.
const RESERVED = /[|{}@[\]()<>#\\*_~]/g;
export function linkedinCommentary(text: string) {
  const escape = (s: string) => s.replace(RESERVED, (c) => `\\${c}`);
  let out = "";
  let last = 0;
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu)) {
    const start = match.index! + match[1].length;
    out += escape(text.slice(last, start)) + `{hashtag|\\#|${escape(match[2])}}`;
    last = start + 1 + match[2].length;
  }
  return out + escape(text.slice(last));
}

async function uploadImages(ctx: StepContext, owner: string): Promise<string[]> {
  const images = ((ctx.checkpoint.images as string[] | undefined) ?? []).slice();
  for (let i = images.length; i < ctx.bundle.media.length; i++) {
    const init = await restJson(ctx, "POST", "/images?action=initializeUpload", { initializeUploadRequest: { owner } }, "Starting the LinkedIn image upload");
    const { uploadUrl, image } = init.value ?? {};
    if (!uploadUrl || !image) throw new PublishError("linkedin_no_upload", "LinkedIn did not start the image upload.", true);
    await put(ctx, String(uploadUrl), await readStored(ctx, ctx.bundle.media[i].url), "Uploading the image to LinkedIn");
    images.push(String(image));
    await ctx.save({ images });
    await ctx.renewLease();
  }
  return images;
}

// Every image must be AVAILABLE before it can be posted.
async function imagesReady(ctx: StepContext, images: string[]) {
  for (const image of images) {
    const body = await restJson(ctx, "GET", `/images/${encodeURIComponent(image)}`, undefined, "Checking the LinkedIn image");
    const status = String(body.status ?? "");
    if (status === "PROCESSING_FAILED") throw new PublishError("image_processing_failed", "LinkedIn could not process one of the images.");
    if (status !== "AVAILABLE") return false;
  }
  return true;
}

async function uploadVideo(ctx: StepContext, owner: string, options: LinkedInOptions & CoverOptions): Promise<string> {
  const video = ctx.bundle.media[0];
  const wantsCover = Boolean(ctx.cover && (options.cover_media_id || options.cover_time_ms !== undefined));
  if (!ctx.checkpoint.video) {
    const init = await restJson(ctx, "POST", "/videos?action=initializeUpload", {
      initializeUploadRequest: { owner, fileSizeBytes: video.size_bytes, uploadCaptions: false, uploadThumbnail: wantsCover },
    }, "Starting the LinkedIn video upload");
    const value = init.value ?? {};
    if (!value.video || !Array.isArray(value.uploadInstructions)) throw new PublishError("linkedin_no_upload", "LinkedIn did not start the video upload.", true);
    // Nothing is posted until the post itself is created, so a lost upload is simply redone.
    await ctx.save({ video: String(value.video), upload_token: String(value.uploadToken ?? ""), parts: value.uploadInstructions as Part[], thumbnail_url: value.thumbnailUploadUrl ?? null, etags: [] });
  }
  const parts = ctx.checkpoint.parts as Part[];
  const etags = ((ctx.checkpoint.etags as string[] | undefined) ?? []).slice();
  for (let i = etags.length; i < parts.length; i++) {
    const part = parts[i];
    const bytes = await readStored(ctx, video.url, { start: part.firstByte, end: part.lastByte });
    const response = await put(ctx, part.uploadUrl, bytes, "Uploading the video to LinkedIn");
    const etag = response.headers.get("etag");
    if (!etag) throw new PublishError("linkedin_upload_unconfirmed", "LinkedIn did not confirm a part of the video upload.", true);
    etags.push(etag);
    await ctx.save({ etags });
    await ctx.renewLease();
  }

  // The cover. The video is fine without it, so a refusal only adds a note.
  if (ctx.checkpoint.thumbnail_url && !ctx.checkpoint.thumbnail_done && ctx.cover) {
    try {
      const jpeg = options.cover_media_id && ctx.cover.image ? (await ctx.cover.image()).bytes : await ctx.cover.frame(options.cover_time_ms ?? 0);
      await put(ctx, String(ctx.checkpoint.thumbnail_url), jpeg, "Uploading the LinkedIn cover", { "media-type-family": "STILLIMAGE" });
    } catch (error) {
      ctx.notes.push(`Posted, but LinkedIn didn't accept the cover${error instanceof Error ? `: ${error.message}` : ""}.`);
    }
    await ctx.save({ thumbnail_done: true });
  }

  const urn = String(ctx.checkpoint.video);
  if (!ctx.checkpoint.finalized) {
    await rest(ctx, "POST", "/videos?action=finalizeUpload", {
      finalizeUploadRequest: { video: urn, uploadToken: String(ctx.checkpoint.upload_token ?? ""), uploadedPartIds: etags },
    }, "Finishing the LinkedIn video upload");
    await ctx.save({ finalized: true });
  }
  return urn;
}

async function videoReady(ctx: StepContext, urn: string) {
  const body = await restJson(ctx, "GET", `/videos/${encodeURIComponent(urn)}`, undefined, "Checking the LinkedIn video");
  const status = String(body.status ?? "");
  if (status === "PROCESSING_FAILED") {
    throw new PublishError("video_processing_failed", `LinkedIn could not process the video${body.processingFailureReason ? `: ${body.processingFailureReason}` : ""}.`);
  }
  return status === "AVAILABLE";
}

export const publishLinkedIn: Adapter = async (ctx) => {
  const options = ctx.bundle.options as LinkedInOptions & CoverOptions;
  const owner = `urn:li:person:${ctx.bundle.account.externalId}`;
  const liveUrl = (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`;

  if (ctx.checkpoint.post_id) return { kind: "published", platformId: String(ctx.checkpoint.post_id), liveUrl: liveUrl(String(ctx.checkpoint.post_id)) };
  if (ctx.checkpoint.publish_started_at) {
    throw new PublishError("unconfirmed", "Posting to LinkedIn was interrupted. Check the LinkedIn profile before posting it again.");
  }

  const type = linkedinMediaType(options, ctx.bundle.media);
  let content: Record<string, unknown> | undefined;
  if (type === "image") {
    const images = await uploadImages(ctx, owner);
    if (!(await imagesReady(ctx, images))) return { kind: "wait", afterMs: 5_000, message: "LinkedIn is processing the images." };
    content = images.length === 1 ? { media: { id: images[0] } } : { multiImage: { images: images.map((id) => ({ id })) } };
  } else if (type === "video") {
    const urn = await uploadVideo(ctx, owner, options);
    if (!(await videoReady(ctx, urn))) return { kind: "wait", afterMs: 15_000, message: "LinkedIn is processing the video." };
    content = { media: { id: urn, ...(options.title?.trim() ? { title: options.title.trim() } : {}) } };
  }

  await ctx.reserve("member_post", POSTS_PER_DAY, 24 * 3600);
  await ctx.save({ publish_started_at: new Date(ctx.now()).toISOString() });
  const response = await rest(ctx, "POST", "/posts", {
    author: owner,
    commentary: linkedinCommentary(captionFor(options, ctx.bundle.caption)),
    visibility: options.visibility ?? "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    ...(content ? { content } : {}),
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  }, "Posting to LinkedIn");
  const id = response.headers.get("x-restli-id") ?? response.headers.get("x-linkedin-id");
  if (!id) return { kind: "published", note: "LinkedIn accepted the post but didn't return its address." };
  await ctx.save({ post_id: id });
  return { kind: "published", platformId: id, liveUrl: liveUrl(id) };
};
