// TikTok Direct Post and inbox drafts, uploading the video from storage in chunks. The
// creator's options are checked right before each post (TikTok requires a fresh check).
// Until every chunk is uploaded TikTok publishes nothing, so an interrupted upload simply
// starts over with a new publish id; once uploaded, the publish id is polled for status.
import type { TikTokOptions } from "../../../backend/lib/publishing/validate";
import { PublishError, platformJson, type Adapter, type StepContext } from "./types";

const API = "https://open.tiktokapis.com/v2";
const MAX_CHUNK = 64 * 1024 * 1024;

export function chunkPlan(size: number) {
  const chunkSize = Math.min(size, MAX_CHUNK);
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < size; start += chunkSize) ranges.push({ start, end: Math.min(start + chunkSize, size) - 1 });
  return { chunkSize, ranges };
}

// TikTok error codes that need a plain explanation rather than TikTok's own text.
const TIKTOK_MESSAGES: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts:
    "Until TikTok approves Post Social's Direct Post review, it can only post to TikTok accounts set to Private. Make the account private in TikTok, or send this as a draft to your TikTok inbox instead.",
  spam_risk_too_many_posts: "TikTok says this account has posted too much today. Try again tomorrow.",
  spam_risk_user_banned_from_posting: "TikTok has blocked this account from posting right now.",
  reached_active_user_cap: "TikTok's daily limit for this app has been reached. Try again tomorrow.",
  privacy_level_option_mismatch: "That audience isn't available for this TikTok account. Choose another.",
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

async function checkCreator(ctx: StepContext, options: TikTokOptions) {
  const info = (await api(ctx, "/post/publish/creator_info/query/", {}, "Checking the TikTok account")).data ?? {};
  if (options.delivery_mode === "inbox") return;
  if (info.can_post === false) throw new PublishError("tiktok_cannot_post", "TikTok says this account can't post right now (often a daily limit). Try again later.", true, new Date(ctx.now() + 3600_000));
  const allowed = (info.privacy_level_options ?? []) as string[];
  if (allowed.length && options.privacy_level && !allowed.includes(options.privacy_level)) {
    throw new PublishError("tiktok_privacy_unavailable", `This TikTok account can't post with that audience. Choose one of: ${allowed.join(", ")}.`);
  }
  const max = Number(info.max_video_post_duration_sec);
  const duration = ctx.bundle.media[0]?.duration_seconds;
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

  if (!ctx.checkpoint.uploaded) {
    await ctx.reserve("publish_init", 6, 60);
    await checkCreator(ctx, options);
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

  const status = (await api(ctx, "/post/publish/status/fetch/", { publish_id: ctx.checkpoint.publish_id }, "Checking the TikTok post")).data ?? {};
  const state = String(status.status ?? "");
  if (state === "PUBLISH_COMPLETE") {
    const raw = status.publicaly_available_post_id ?? status.publicly_available_post_id;
    const postId = Array.isArray(raw) ? raw[0] : raw;
    const handle = ctx.bundle.account.handle.replace(/^@/, "");
    return {
      kind: "published",
      platformId: String(postId ?? ctx.checkpoint.publish_id),
      liveUrl: postId && handle ? `https://www.tiktok.com/@${handle}/video/${postId}` : undefined,
      note: postId ? undefined : options.privacy_level === "SELF_ONLY" ? "Posted privately on TikTok, so it has no public link." : undefined,
    };
  }
  if (state === "SEND_TO_USER_INBOX") return { kind: "published", platformId: String(ctx.checkpoint.publish_id), note: "Sent to your TikTok drafts. Open TikTok to finish and post it." };
  if (state === "FAILED") throw new PublishError(`tiktok_${status.fail_reason ?? "failed"}`, `TikTok could not publish the video${status.fail_reason ? ` (${String(status.fail_reason).replace(/_/g, " ")})` : ""}.`);
  return { kind: "wait", afterMs: 10_000, message: "TikTok is processing the video." };
};
