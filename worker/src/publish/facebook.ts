// Facebook Pages: text, link, image, Reels and Page videos. Text, link, image and video
// posts are a single call, so before making it the start time is saved; if the worker
// crashes, the retry looks for the post on the Page instead of posting again.
import { captionFor, type FacebookOptions } from "../../../backend/lib/publishing/validate";
import { PublishError, platformJson, type Adapter, type StepContext } from "./types";

const GRAPH = "https://graph.facebook.com/v25.0";

async function graph(ctx: StepContext, method: "GET" | "POST", path: string, params: Record<string, string>, what: string) {
  const token = await ctx.token();
  const url = new URL(GRAPH + path);
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    return platformJson(await ctx.http(url), what);
  }
  return platformJson(await ctx.http(url, { method: "POST", body: new URLSearchParams({ ...params, access_token: token }) }), what);
}

const sinceParam = (ctx: StepContext) => String(Math.floor(Date.parse(String(ctx.checkpoint.publish_started_at)) / 1000) - 300);

// After a crash during a single-call publish: did it reach the Page?
async function findOnPage(ctx: StepContext, edge: "feed" | "photos" | "videos", text: string) {
  const pageId = ctx.bundle.account.externalId;
  const fields = edge === "feed" ? "id,message,created_time" : edge === "photos" ? "id,name,created_time" : "id,description,created_time";
  const params: Record<string, string> = { fields, limit: "25", since: sinceParam(ctx) };
  if (edge === "photos") params.type = "uploaded";
  const list = await graph(ctx, "GET", `/${pageId}/${edge}`, params, "Checking the Page for the post");
  const items = (list.data ?? []) as Array<Record<string, string>>;
  return items.find((item) => (item.message ?? item.name ?? item.description ?? "") === text);
}

const postUrl = (id: string) => `https://www.facebook.com/${id}`;

async function single(ctx: StepContext, options: FacebookOptions, caption: string): Promise<{ id: string; videoId?: string }> {
  const pageId = ctx.bundle.account.externalId;
  if (ctx.checkpoint.publish_started_at && !ctx.checkpoint.post_id) {
    const edge = options.media_type === "image" ? "photos" : options.media_type === "video" ? "videos" : "feed";
    const found = await findOnPage(ctx, edge, caption);
    if (found) {
      await ctx.save({ post_id: found.id });
      return { id: found.id, videoId: edge === "videos" ? found.id : undefined };
    }
    // Not on the Page. A text/link/image post that failed this fast never posted, but a
    // video can take minutes to appear, so for videos we cannot be sure.
    if (options.media_type === "video") {
      throw new PublishError("unconfirmed", "The video upload was interrupted and it is not on the Page yet. Check the Page before posting it again.");
    }
  }
  await ctx.reserve("page_publish", 180, 3600);
  await ctx.save({ publish_started_at: new Date(ctx.now()).toISOString() });
  if (options.media_type === "image") {
    const result = await graph(ctx, "POST", `/${pageId}/photos`, { url: ctx.bundle.media[0].url, caption, published: "true" }, "Posting the photo to Facebook");
    const id = String(result.post_id ?? result.id);
    await ctx.save({ post_id: id });
    return { id };
  }
  if (options.media_type === "video") {
    const params: Record<string, string> = { file_url: ctx.bundle.media[0].url, description: caption };
    if (options.title) params.title = options.title;
    const result = await graph(ctx, "POST", `/${pageId}/videos`, params, "Uploading the video to Facebook");
    await ctx.save({ post_id: String(result.id), video_id: String(result.id) });
    return { id: String(result.id), videoId: String(result.id) };
  }
  const params: Record<string, string> = { message: caption };
  if (options.media_type === "link" && options.link) params.link = options.link;
  const result = await graph(ctx, "POST", `/${pageId}/feed`, params, "Posting to Facebook");
  await ctx.save({ post_id: String(result.id) });
  return { id: String(result.id) };
}

// Facebook processes videos after upload; wait until it is ready or fails.
async function videoReady(ctx: StepContext, videoId: string, reel: boolean) {
  const body = await graph(ctx, "GET", `/${videoId}`, { fields: "status" }, "Checking the Facebook video");
  const status = body.status ?? {};
  const video = String(status.video_status ?? "");
  const publishing = String(status.publishing_phase?.status ?? "");
  if (video === "error" || status.processing_phase?.status === "error") {
    const reason = status.processing_phase?.errors?.[0]?.message ?? status.uploading_phase?.errors?.[0]?.message;
    throw new PublishError("video_processing_failed", `Facebook could not process the video${reason ? `: ${reason}` : ""}.`);
  }
  if (reel) return video === "ready" && (publishing === "complete" || publishing === "");
  return video === "ready";
}

async function reel(ctx: StepContext, caption: string) {
  const pageId = ctx.bundle.account.externalId;
  if (!ctx.checkpoint.video_id) {
    await ctx.reserve("page_publish", 180, 3600);
    const started = await graph(ctx, "POST", `/${pageId}/video_reels`, { upload_phase: "start" }, "Starting the Facebook Reel upload");
    await ctx.save({ video_id: String(started.video_id) });
  }
  const videoId = String(ctx.checkpoint.video_id);
  if (!ctx.checkpoint.uploaded) {
    // Facebook pulls the file from our signed link.
    const token = await ctx.token();
    const response = await ctx.http(`https://rupload.facebook.com/video-upload/v25.0/${videoId}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_url: ctx.bundle.media[0].url },
    });
    const body = await platformJson(response, "Uploading the Facebook Reel");
    if (body.success === false) throw new PublishError("upload_failed", "Facebook did not accept the Reel upload.", true);
    await ctx.save({ uploaded: true });
  }
  if (!ctx.checkpoint.publish_started_at) {
    await ctx.save({ publish_started_at: new Date(ctx.now()).toISOString() });
    await graph(ctx, "POST", `/${pageId}/video_reels`, { upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: caption }, "Publishing the Facebook Reel");
  } else {
    // Resuming: if the finish call never landed, the publishing phase has not started.
    const body = await graph(ctx, "GET", `/${videoId}`, { fields: "status" }, "Checking the Facebook Reel");
    if (String(body.status?.publishing_phase?.status ?? "not_started") === "not_started") {
      await graph(ctx, "POST", `/${pageId}/video_reels`, { upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: caption }, "Publishing the Facebook Reel");
    }
  }
  return videoId;
}

export const publishFacebook: Adapter = async (ctx) => {
  const options = ctx.bundle.options as FacebookOptions;
  const caption = captionFor(options, ctx.bundle.caption);

  if (options.media_type === "reel") {
    const videoId = await reel(ctx, caption);
    if (!(await videoReady(ctx, videoId, true))) return { kind: "wait", afterMs: 15_000, message: "Facebook is processing the Reel." };
    return { kind: "published", platformId: videoId, liveUrl: `https://www.facebook.com/reel/${videoId}` };
  }

  const post = ctx.checkpoint.post_id
    ? { id: String(ctx.checkpoint.post_id), videoId: ctx.checkpoint.video_id as string | undefined }
    : await single(ctx, options, caption);
  if (options.media_type === "video" && post.videoId) {
    if (!(await videoReady(ctx, post.videoId, false))) return { kind: "wait", afterMs: 15_000, message: "Facebook is processing the video." };
    return { kind: "published", platformId: post.videoId, liveUrl: `https://www.facebook.com/${ctx.bundle.account.externalId}/videos/${post.videoId}` };
  }
  return { kind: "published", platformId: post.id, liveUrl: postUrl(post.id) };
};
