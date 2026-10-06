// TikTok Direct Post and inbox drafts. Videos are uploaded from storage in chunks; photo
// posts (1 to 35 images, a swipeable carousel) are fetched by TikTok from our verified
// domain (tiktok-photos.ts). The creator's options are checked right before each post
// (TikTok requires a fresh check). Until a video's chunks are all uploaded TikTok publishes
// nothing, so an interrupted upload starts over with a new publish id; once a post is
// handed over, its publish id is polled for status.
import { tiktokMediaType, type TikTokOptions } from "../../../backend/lib/publishing/validate";
import { PublishError, platformJson, type Adapter, type StepContext } from "./types";

const API = "https://open.tiktokapis.com/v2";
const MAX_CHUNK = 64 * 1024 * 1024;

// TikTok's rules: chunks of 5 to 64 MB; the count is size / chunk size rounded DOWN, and the
// last chunk takes the remainder (up to 128 MB); videos over 64 MB need at least 2 chunks;
// up to 64 MB goes in one piece.
export function chunkPlan(size: number) {
  const chunkSize = size <= MAX_CHUNK ? size : size < 2 * MAX_CHUNK ? Math.floor(size / 2) : MAX_CHUNK;
  const count = Math.max(1, Math.floor(size / chunkSize));
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) ranges.push({ start: i * chunkSize, end: i === count - 1 ? size - 1 : (i + 1) * chunkSize - 1 });
  return { chunkSize, ranges };
}

// TikTok error codes that need a plain explanation rather than TikTok's own text.
const TIKTOK_MESSAGES: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts:
    "Until TikTok approves Post Social's Direct Post review, it can only post to TikTok accounts set to Private. Make the account private in TikTok, or send this as a draft to your TikTok inbox instead.",
  spam_risk_too_many_posts: "TikTok says this account has posted too much today. Try again tomorrow.",
  spam_risk_too_many_pending_share: "TikTok has several Post Social drafts waiting in this account's inbox. Open TikTok to post or delete them, then try again.",
  spam_risk_user_banned_from_posting: "TikTok has blocked this account from posting right now.",
  reached_active_user_cap: "TikTok's daily limit for this app has been reached. Try again tomorrow.",
  privacy_level_option_mismatch: "That audience isn't available for this TikTok account. Choose another.",
  url_ownership_unverified: "TikTok couldn't fetch the photos because Post Social's photo address isn't verified with TikTok yet.",
};

async function api(ctx: StepContext, path: string, body: unknown, what: string) {
  const response = await ctx.http(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await ctx.token()}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  try {
    return await platformJson(response, what);
  } catch (error) {
    if (error instanceof PublishError && TIKTOK_MESSAGES[error.code]) {
      const transient = error.code === "spam_risk_too_many_posts" || error.code === "reached_active_user_cap";
      throw new PublishError(error.code, TIKTOK_MESSAGES[error.code], transient, transient ? new Date(ctx.now() + 12 * 3600_000) : undefined);
    }
    throw error;
  }
}

async function checkCreator(ctx: StepContext, options: TikTokOptions, photo: boolean) {
  const info = (await api(ctx, "/post/publish/creator_info/query/", {}, "Checking the TikTok account")).data ?? {};
  if (options.delivery_mode === "inbox") return;
  if (info.can_post === false) throw new PublishError("tiktok_cannot_post", "TikTok says this account can't post right now (often a daily limit). Try again later.", true, new Date(ctx.now() + 3600_000));
  const allowed = (info.privacy_level_options ?? []) as string[];
  if (allowed.length && options.privacy_level && !allowed.includes(options.privacy_level)) {
    throw new PublishError("tiktok_privacy_unavailable", `This TikTok account can't post with that audience. Choose one of: ${allowed.join(", ")}.`);
  }
  const max = Number(info.max_video_post_duration_sec);
  const duration = photo ? null : ctx.bundle.media[0]?.duration_seconds;
  if (max && duration && duration > max) throw new PublishError("tiktok_video_too_long", `This TikTok account allows videos up to ${max} seconds; this one is ${Math.round(duration)}.`);
  if (options.comments_enabled && info.comment_disabled) throw new PublishError("tiktok_comments_off", "Comments are turned off for this TikTok account; turn them off for this post.");
  if (options.duet_enabled && info.duet_disabled) throw new PublishError("tiktok_duet_off", "Duet is turned off for this TikTok account; turn it off for this post.");
  if (options.stitch_enabled && info.stitch_disabled) throw new PublishError("tiktok_stitch_off", "Stitch is turned off for this TikTok account; turn it off for this post.");
}

export const publishTikTok: Adapter = async (ctx) => {
  const options = ctx.bundle.options as TikTokOptions;
  const video = ctx.bundle.media[0];
  if (options.delivery_mode === "inbox" && !ctx.bundle.account.scopes.includes("video.upload")) {
    throw new PublishError("tiktok_reconnect", "Reconnect this TikTok account to allow sending drafts.", false, undefined, true);
  }

  const photo = tiktokMediaType(options, ctx.bundle.media) === "photo";
  if (!ctx.checkpoint.uploaded && photo) return startPhotoPost(ctx, options);

  if (!ctx.checkpoint.uploaded) {
    await ctx.reserve("publish_init", 6, 60);
    await checkCreator(ctx, options, false);
    const { chunkSize, ranges } = chunkPlan(video.size_bytes);
    const source_info = { source: "FILE_UPLOAD", video_size: video.size_bytes, chunk_size: chunkSize, total_chunk_count: ranges.length };
    const init = options.delivery_mode === "inbox"
      ? await api(ctx, "/post/publish/inbox/video/init/", { source_info }, "Starting the TikTok draft upload")
      : await api(ctx, "/post/publish/video/init/", {
          post_info: {
            title: ctx.bundle.caption,
            privacy_level: options.privacy_level,
            disable_comment: !options.comments_enabled,
            disable_duet: !options.duet_enabled,
            disable_stitch: !options.stitch_enabled,
            brand_content_toggle: options.disclose_branded_content ?? false,
            brand_organic_toggle: options.disclose_your_brand ?? false,
            is_aigc: options.ai_generated ?? false,
          },
          source_info,
        }, "Starting the TikTok upload");
    const publishId = String(init.data?.publish_id ?? "");
    const uploadUrl = String(init.data?.upload_url ?? "");
    if (!publishId || !uploadUrl) throw new PublishError("tiktok_init_failed", "TikTok did not start the upload.", true);
    await ctx.save({ publish_id: publishId });

    for (const { start, end } of ranges) {
      const source = await ctx.http(video.url, { headers: { Range: `bytes=${start}-${end}` } });
      if (!source.ok) throw new PublishError("media_unavailable", "The stored video could not be read.", true);
      const bytes = new Uint8Array(await source.arrayBuffer());
      const put = await ctx.http(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": video.mime_type, "Content-Length": String(bytes.byteLength), "Content-Range": `bytes ${start}-${end}/${video.size_bytes}` },
        body: bytes,
      });
      // An interrupted upload never publishes; a retry starts a fresh one.
      if (!put.ok) throw new PublishError(`upload_${put.status}`, "TikTok did not accept the video upload.", put.status >= 500 || put.status === 429);
      await ctx.renewLease();
    }
    await ctx.save({ uploaded: true, publish_started_at: new Date(ctx.now()).toISOString() });
    return { kind: "wait", afterMs: 10_000, message: "TikTok is processing the video." };
  }

  const kind = photo ? "photos" : "video";
  const status = (await api(ctx, "/post/publish/status/fetch/", { publish_id: ctx.checkpoint.publish_id }, "Checking the TikTok post")).data ?? {};
  const state = String(status.status ?? "");
  if (state === "PUBLISH_COMPLETE") {
    const raw = status.publicaly_available_post_id ?? status.publicly_available_post_id;
    const postId = Array.isArray(raw) ? raw[0] : raw;
    const handle = ctx.bundle.account.handle.replace(/^@/, "");
    return {
      kind: "published",
      platformId: String(postId ?? ctx.checkpoint.publish_id),
      liveUrl: postId && handle ? `https://www.tiktok.com/@${handle}/${photo ? "photo" : "video"}/${postId}` : undefined,
      note: postId ? undefined : options.privacy_level === "SELF_ONLY" ? "Posted privately on TikTok, so it has no public link." : undefined,
    };
  }
  if (state === "SEND_TO_USER_INBOX") return { kind: "published", drafted: true, platformId: String(ctx.checkpoint.publish_id), note: "Sent to your TikTok drafts. Open TikTok to finish and post it." };
  if (state === "FAILED") {
    const reason = String(status.fail_reason ?? "");
    if (TIKTOK_MESSAGES[reason]) throw new PublishError(`tiktok_${reason}`, TIKTOK_MESSAGES[reason]);
    throw new PublishError(`tiktok_${reason || "failed"}`, `TikTok could not publish the ${kind}${reason ? ` (${reason.replace(/_/g, " ")})` : ""}.`);
  }
  return { kind: "wait", afterMs: 10_000, message: `TikTok is processing the ${kind}.` };
};

// Photo posts: TikTok fetches each image itself, so one call hands the whole post over.
async function startPhotoPost(ctx: StepContext, options: TikTokOptions) {
  // The hand-over below may have reached TikTok before this worker stopped: never send twice.
  if (ctx.checkpoint.photo_post_sent_at) {
    throw new PublishError("unconfirmed", "The photos may already be on TikTok, but Post Social didn't get TikTok's answer. Check your TikTok profile before posting again.");
  }
  if (!ctx.tiktokPhotoLinks) throw new PublishError("tiktok_photos_unavailable", "This worker can't prepare TikTok photos.", true);
  await ctx.reserve("publish_init", 6, 60);
  await checkCreator(ctx, options, true);
  let links: string[];
  try {
    links = await ctx.tiktokPhotoLinks(ctx.bundle.media, ctx.renewLease);
  } catch (error) {
    throw new PublishError("tiktok_photo_prepare", error instanceof Error ? error.message : "The photos could not be prepared for TikTok.", true);
  }
  const inbox = options.delivery_mode === "inbox";
  const text = { ...(options.title?.trim() ? { title: options.title.trim() } : {}), description: ctx.bundle.caption };
  await ctx.save({ photo_post_sent_at: new Date(ctx.now()).toISOString() });
  const init = await api(ctx, "/post/publish/content/init/", {
    post_info: inbox
      ? text
      : {
          ...text,
          privacy_level: options.privacy_level,
          disable_comment: !options.comments_enabled,
          brand_content_toggle: options.disclose_branded_content ?? false,
          brand_organic_toggle: options.disclose_your_brand ?? false,
        },
    source_info: { source: "PULL_FROM_URL", photo_images: links, photo_cover_index: 0 },
    post_mode: inbox ? "MEDIA_UPLOAD" : "DIRECT_POST",
    media_type: "PHOTO",
    ...(options.ai_generated ? { is_aigc: true } : {}),
  }, inbox ? "Sending the photos to TikTok drafts" : "Posting the photos to TikTok").catch(async (error) => {
    // TikTok answered with an error, so nothing was posted: a retry may send again.
    if (error instanceof PublishError) await ctx.save({ photo_post_sent_at: null });
    throw error;
  });
  const publishId = String(init.data?.publish_id ?? "");
  if (!publishId) throw new PublishError("tiktok_init_failed", "TikTok did not accept the photo post.", true);
  await ctx.save({ publish_id: publishId, uploaded: true, publish_started_at: new Date(ctx.now()).toISOString() });
  return { kind: "wait" as const, afterMs: 10_000, message: "TikTok is processing the photos." };
}
