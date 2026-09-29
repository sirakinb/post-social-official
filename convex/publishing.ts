"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { buildInstagramCarouselPlan, buildTikTokChunkPlan, classifyThreadsContainerStatus, classifyTikTokStatus, nextMidnightPacific, platformResponseError } from "./lib/platformRules";
import { ensureFreshAccessToken, uploadShort } from "./lib/youtubeService";

const META_VERSION = "v25.0";

class PublishError extends Error { constructor(public code: string, message: string, public retryable = false, public retryAt?: number) { super(message); } }

async function reservePlatformCall(ctx: any, bundle: any, operation: string, limit: number, windowMs: number) {
  const result = await ctx.runMutation(internal.rateLimits.reserve, {
    workspaceId: bundle.job.workspaceId,
    connectedAccountId: bundle.account._id,
    platform: bundle.account.platform,
    operation,
    limit,
    windowMs,
  });
  if (!result.allowed) throw new PublishError("local_rate_limit", "This platform's safe publishing limit has been reached. Post Social will try again after the limit resets.", true, result.retryAt);
}

async function platformJson(response: Response) {
  const data = await response.json();
  const code = platformResponseError(response.ok, response.status, data.error);
  if (code) throw new PublishError(code, data.error?.message ?? "The platform could not accept this post.", response.status === 429 || response.status >= 500);
  return data;
}

async function threadsJson(response: Response, stage: "create" | "publish") {
  const data = await response.json();
  console.info("threads_api", {
    stage,
    status: response.status,
    ok: response.ok,
    hasId: typeof data.id === "string" || typeof data.id === "number",
    errorCode: data.error?.code,
    errorSubcode: data.error?.error_subcode,
    errorType: data.error?.type,
    errorMessage: data.error?.message,
  });
  const code = platformResponseError(response.ok, response.status, data.error);
  if (code) throw new PublishError(code, data.error?.message ?? "The platform could not accept this post.", response.status === 429 || response.status >= 500);
  return data;
}

async function submitTikTok(bundle: any, token: string) {
  const asset = bundle.media.find((item: any) => item.mediaType === "video");
  const inbox = bundle.destination.options.deliveryMode === "inbox";
  if (inbox) {
    if (!asset?.url) throw new PublishError("media_missing", "TikTok draft upload needs one video.");
    // Accounts connected before draft upload existed lack this permission and must reconnect once.
    if (!(bundle.account.scopes ?? []).includes("video.upload")) throw new PublishError("tiktok_reconnect_required", "Reconnect this TikTok account to allow draft uploads (it needs the video.upload permission).");
  }
  if (!asset?.url) return await submitTikTokPhotos(bundle, token);
  let plan;
  try { plan = buildTikTokChunkPlan(Number(asset.sizeBytes)); }
  catch (cause) {
    const code = cause instanceof Error ? cause.message : "media_size_missing";
    throw new PublishError(code, code === "video_too_large" ? "TikTok Direct Post accepts videos up to 1 GB." : "The video size could not be verified.");
  }
  const { videoSize, chunkSize, totalChunkCount, ranges } = plan;
  const options = bundle.destination.options;
  const sourceInfo = { source: "FILE_UPLOAD", video_size: videoSize, chunk_size: chunkSize, total_chunk_count: totalChunkCount };
  // Drafts go to the creator's inbox and take no post_info; the creator sets caption and privacy in TikTok.
  const initUrl = inbox ? "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/" : "https://open.tiktokapis.com/v2/post/publish/video/init/";
  const initBody = inbox
    ? { source_info: sourceInfo }
    : { post_info: { title: bundle.post.caption, privacy_level: options.privacyLevel, disable_duet: !options.duetEnabled, disable_comment: !options.commentEnabled, disable_stitch: !options.stitchEnabled, brand_content_toggle: options.brandedContentEnabled, brand_organic_toggle: options.yourBrandEnabled, is_aigc: options.aiGenerated ?? false }, source_info: sourceInfo };
  const initialized = await platformJson(await fetch(initUrl, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(initBody) }));
  for (const { start, end, length: expectedLength } of ranges) {
    const fileResponse = await fetch(asset.url, {
      headers: videoSize > chunkSize ? { Range: `bytes=${start}-${end}` } : undefined,
    });
    if (!fileResponse.ok) throw new PublishError("media_unavailable", "The video could not be opened.", true);
    if (videoSize > chunkSize && fileResponse.status !== 206) {
      throw new PublishError("media_range_unsupported", "The stored video could not be read in safe upload chunks.");
    }
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    if (bytes.byteLength !== expectedLength) throw new PublishError("media_chunk_mismatch", "A video upload chunk did not match the stored file.", true);
    const upload = await fetch(initialized.data.upload_url, { method: "PUT", headers: { "Content-Type": asset.mimeType, "Content-Length": String(bytes.byteLength), "Content-Range": `bytes ${start}-${end}/${videoSize}` }, body: bytes });
    if (!upload.ok) throw new PublishError(`upload_${upload.status}`, "TikTok could not receive the video.", upload.status >= 500);
  }
  return initialized.data.publish_id as string;
}

async function submitTikTokPhotos(bundle: any, token: string) {
  const images = bundle.media.filter((item: any) => item.mediaType === "image" && item.url);
  if (images.length === 0) throw new PublishError("media_missing", "TikTok needs a video or image.");
  if (images.length > 35) throw new PublishError("too_many_photos", "TikTok accepts up to 35 images in one photo post.");
  const options = bundle.destination.options;
  const initialized = await platformJson(await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: bundle.post.caption,
        privacy_level: options.privacyLevel,
        disable_comment: !options.commentEnabled,
        auto_add_music: true,
        brand_content_toggle: options.brandedContentEnabled,
        brand_organic_toggle: options.yourBrandEnabled,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: images.map((image: any) => image.url),
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    }),
  }));
  return initialized.data.publish_id as string;
}

function classifyYouTubeFailure(cause: unknown): PublishError {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("quotaExceeded")) {
    return new PublishError(
      "youtube_quota_exceeded",
      "YouTube's daily upload quota is used up. Post Social will retry after the quota resets at midnight Pacific time.",
      true,
      nextMidnightPacific(Date.now())
    );
  }
  if (message.includes("invalid_grant")) {
    return new PublishError("youtube_reconnect_required", "YouTube access was revoked. Reconnect the account to continue publishing.");
  }
  if (message.includes("refresh_token")) {
    return new PublishError("youtube_reconnect_required", "The YouTube connection is missing publishing access. Reconnect the account.");
  }
  return new PublishError("youtube_upload_failed", "YouTube could not accept this video.", true);
}

async function publishYouTube(ctx: any, bundle: any) {
  const asset = bundle.media.find((item: any) => item.mediaType === "video" && item.url);
  if (!asset) throw new PublishError("media_missing", "YouTube needs one video file.");
  const credentialRecord = await ctx.runQuery(internal.credentials.readEncrypted, { credentialId: bundle.account.credentialId });
  if (!credentialRecord) throw new PublishError("credential_missing", "The YouTube connection could not be opened.");
  const tokens = await ctx.runAction(internal.credentialVault.decrypt, { credentialId: bundle.account.credentialId });
  if (!tokens.refreshToken) {
    await ctx.runMutation(internal.credentials.markRefreshFailed, {
      credentialId: bundle.account.credentialId,
      reason: "YouTube publishing access expired. Reconnect this account to continue.",
    });
    throw new PublishError("youtube_reconnect_required", "The YouTube connection is missing publishing access. Reconnect the account.");
  }

  let accessToken: string;
  try {
    accessToken = await ensureFreshAccessToken(
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: new Date(credentialRecord.accessTokenExpiresAt ?? 0),
      },
      async (freshToken, expiresAt) => {
        await ctx.runAction(internal.credentialVault.encryptAndStore, {
          credentialId: bundle.account.credentialId,
          workspaceId: bundle.job.workspaceId,
          platform: "youtube",
          accessToken: freshToken,
          refreshToken: tokens.refreshToken,
          accessTokenExpiresAt: expiresAt.getTime(),
        });
      }
    );
  } catch (cause) {
    const error = classifyYouTubeFailure(cause);
    if (error.code === "youtube_reconnect_required") {
      await ctx.runMutation(internal.credentials.markRefreshFailed, {
        credentialId: bundle.account.credentialId,
        reason: "YouTube publishing access expired. Reconnect this account to continue.",
      });
    }
    throw error;
  }

  const fileResponse = await fetch(asset.url);
  if (!fileResponse.ok) throw new PublishError("media_unavailable", "The video could not be opened.", true);
  const videoBuffer = Buffer.from(await fileResponse.arrayBuffer());
  const options = bundle.destination.options;
  try {
    const result = await uploadShort(accessToken, {
      title: options.title,
      description: options.description ?? bundle.post.caption,
      privacyStatus: options.privacyStatus,
      videoBuffer,
      mimeType: asset.mimeType,
    });
    if (result.channelTitle || result.channelId) {
      await ctx.runMutation(internal.publishingData.updateYouTubeIdentity, {
        accountId: bundle.account._id,
        channelId: result.channelId,
        channelTitle: result.channelTitle,
      });
    }
    return { platformRequestId: result.videoId, liveUrl: result.watchUrl };
  } catch (cause) {
    throw classifyYouTubeFailure(cause);
  }
}

async function waitForInstagramContainer(containerId: string, token: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await platformJson(await fetch(`https://graph.instagram.com/${META_VERSION}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`));
    if (result.status_code === "FINISHED") return;
    if (result.status_code === "ERROR" || result.status_code === "EXPIRED") throw new PublishError("container_failed", result.status ?? "Instagram could not prepare the media.", true);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new PublishError("container_processing", "Instagram is still preparing the media.", true);
}

async function getInstagramContainerStatus(containerId: string, token: string) {
  return await platformJson(await fetch(`https://graph.instagram.com/${META_VERSION}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`));
}

async function finalizeInstagramContainer(accountId: string, containerId: string, token: string) {
  const published = await platformJson(await fetch(`https://graph.instagram.com/${META_VERSION}/${accountId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: containerId, access_token: token }),
  }));
  const publishedMedia = await platformJson(await fetch(`https://graph.instagram.com/${META_VERSION}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`));
  return { platformRequestId: String(published.id), liveUrl: publishedMedia.permalink as string | undefined };
}

async function publishInstagram(bundle: any, token: string) {
  const asset = bundle.media[0]; if (!asset?.url) throw new PublishError("media_missing", "Instagram needs a media file.");
  const caption = bundle.destination.options.caption ?? bundle.post.caption;
  let container: { id: string };
  if (bundle.destination.options.mediaType === "carousel") {
    let plan;
    try { plan = buildInstagramCarouselPlan(bundle.media); }
    catch (cause) {
      const code = cause instanceof Error ? cause.message : "carousel_invalid";
      const message = code === "carousel_needs_two_items" ? "An Instagram carousel needs at least two media files." : code === "carousel_too_many_items" ? "Instagram carousels support up to ten media files." : "One or more Instagram carousel files are unavailable.";
      throw new PublishError(code, message);
    }
    const childIds: string[] = [];
    for (const item of plan) {
      const childParams = new URLSearchParams({ access_token: token, is_carousel_item: "true" });
      if (item.mediaType === "video") { childParams.set("media_type", "VIDEO"); childParams.set("video_url", item.url); }
      else childParams.set("image_url", item.url);
      const child = await platformJson(await fetch(`https://graph.instagram.com/${META_VERSION}/${bundle.account.externalAccountId}/media`, { method: "POST", body: childParams }));
      if (item.mediaType === "video") await waitForInstagramContainer(child.id, token);
      childIds.push(String(child.id));
    }
    const parentParams = new URLSearchParams({ access_token: token, media_type: "CAROUSEL", children: childIds.join(","), caption });
    container = await platformJson(await fetch(`https://graph.instagram.com/${META_VERSION}/${bundle.account.externalAccountId}/media`, { method: "POST", body: parentParams }));
  } else {
    if (bundle.media.length > 1) throw new PublishError("media_type_mismatch", "Choose the Instagram carousel format when attaching more than one file.");
    const params = new URLSearchParams({ access_token: token, caption });
    if (asset.mediaType === "video") { params.set("media_type", "REELS"); params.set("video_url", asset.url); } else params.set("image_url", asset.url);
    container = await platformJson(await fetch(`https://graph.instagram.com/${META_VERSION}/${bundle.account.externalAccountId}/media`, { method: "POST", body: params }));
  }
  return { processingContainerId: String(container.id) };
}

async function fetchTikTokStatus(publishId: string, token: string) {
  return await platformJson(await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  }));
}

function tiktokLiveUrl(id: string | undefined, handle: string) {
  const username = handle.replace(/^@/, "");
  return id && username ? `https://www.tiktok.com/@${username}/video/${id}` : undefined;
}

async function publishFacebook(bundle: any, token: string) {
  const asset = bundle.media[0]; const pageId = bundle.account.externalAccountId; let endpoint = "feed"; const params = new URLSearchParams({ access_token: token, message: bundle.destination.options.message ?? bundle.post.caption });
  if (asset?.mediaType === "image" && asset.url) { endpoint = "photos"; params.set("url", asset.url); }
  if (asset?.mediaType === "video") throw new PublishError("video_permission_required", "Facebook video publishing will be enabled after its separate permission is approved.");
  const published = await platformJson(await fetch(`https://graph.facebook.com/${META_VERSION}/${pageId}/${endpoint}`, { method: "POST", body: params })); const id = String(published.post_id ?? published.id);
  return { platformRequestId: id, liveUrl: `https://www.facebook.com/${id}` };
}

async function waitForThreadsContainer(containerId: string, token: string) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const result = await platformJson(await fetch(
      `https://graph.threads.net/v1.0/${containerId}?fields=id,status,error_message&access_token=${encodeURIComponent(token)}`,
    ));
    const outcome = classifyThreadsContainerStatus(result);
    if (outcome.kind === "ready") return;
    if (outcome.kind === "failed") {
      throw new PublishError("threads_container_failed", outcome.reason);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new PublishError(
    "threads_container_processing",
    "Threads is taking longer than expected to prepare this image. Post Social will try again.",
    true,
  );
}

async function publishThreads(bundle: any, token: string) {
  const options = bundle.destination.options;
  const threadsUserId = String(bundle.account.externalAccountId);
  const params = new URLSearchParams({
    access_token: token,
    media_type: options.mediaType === "image" ? "IMAGE" : "TEXT",
    text: options.text,
  });
  if (options.mediaType === "image") {
    const asset = bundle.media[0];
    if (!asset?.url || asset.mediaType !== "image") {
      throw new PublishError("threads_image_missing", "The Threads image could not be opened.");
    }
    params.set("image_url", asset.url);
  }
  const container = await threadsJson(await fetch(`https://graph.threads.net/v1.0/${threadsUserId}/threads`, {
    method: "POST",
    body: params,
  }), "create");
  if (options.mediaType === "image") {
    await waitForThreadsContainer(String(container.id), token);
  } else {
    // Text containers are not consistently queryable through the status
    // endpoint, but publishing in the same tick can race their creation.
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  const published = await threadsJson(await fetch(`https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`, {
    method: "POST",
    body: new URLSearchParams({
      access_token: token,
      creation_id: String(container.id),
    }),
  }), "publish");
  let liveUrl: string | undefined;
  try {
    const response = await fetch(`https://graph.threads.net/v1.0/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`);
    if (response.ok) {
      const media = await response.json();
      if (!media.error && typeof media.permalink === "string") liveUrl = media.permalink;
    }
  } catch {
    // Publishing already succeeded. A missing permalink must not retry and duplicate the post.
  }
  return {
    platformRequestId: String(published.id),
    liveUrl,
  };
}

export const processJob = internalAction({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, { jobId }) => {
    const claimed = await ctx.runMutation(internal.publishingData.markRunning, { jobId }); if (!claimed) return;
    const bundle = await ctx.runQuery(internal.publishingData.getJobBundle, { jobId }); if (!bundle) return;
    try {
      const credential = await ctx.runAction(internal.credentialVault.decrypt, { credentialId: bundle.account.credentialId });
      if (bundle.destination.platform === "tiktok") {
        await reservePlatformCall(ctx, bundle, "publish_init", 6, 60_000);
        const publishId = await submitTikTok(bundle, credential.accessToken);
        await ctx.runMutation(internal.publishingData.markSubmitted, { jobId, platformRequestId: publishId });
        await ctx.scheduler.runAfter(10_000, internal.publishing.checkTikTokStatus, { jobId });
        return;
      }
      if (bundle.destination.platform === "youtube") {
        // videos.insert costs 1600 of the default 10,000 daily quota units,
        // so six uploads per day is the safe local ceiling.
        await reservePlatformCall(ctx, bundle, "video_upload", 6, 24 * 60 * 60 * 1000);
        const result = await publishYouTube(ctx, bundle);
        await ctx.runMutation(internal.publishingData.markSucceeded, { jobId, ...result });
        return;
      }
      if (bundle.destination.platform === "instagram") {
        await reservePlatformCall(ctx, bundle, "media_publish", 100, 24 * 60 * 60 * 1000);
      } else if (bundle.destination.platform === "threads") {
        await reservePlatformCall(ctx, bundle, "threads_publish", 250, 24 * 60 * 60 * 1000);
      } else {
        await reservePlatformCall(ctx, bundle, "page_publish", 180, 60 * 60 * 1000);
      }
      const result = bundle.destination.platform === "instagram"
        ? await publishInstagram(bundle, credential.accessToken)
        : bundle.destination.platform === "threads"
          ? await publishThreads(bundle, credential.accessToken)
          : await publishFacebook(bundle, credential.accessToken);
      if ("processingContainerId" in result) {
        await ctx.runMutation(internal.publishingData.markSubmitted, { jobId, platformRequestId: result.processingContainerId });
        await ctx.scheduler.runAfter(15_000, internal.publishing.checkInstagramStatus, { jobId });
        return;
      }
      await ctx.runMutation(internal.publishingData.markSucceeded, { jobId, ...result });
    } catch (cause) {
      const error = cause instanceof PublishError ? cause : new PublishError("platform_unavailable", "The platform could not be reached.", true); const retry = error.retryable && bundle.job.attemptCount < 3; const retryAt = retry ? (error.retryAt ?? Date.now() + [15_000, 60_000, 300_000][Math.min(bundle.job.attemptCount, 2)]) : undefined;
      await ctx.runMutation(internal.publishingData.markFailed, { jobId, code: error.code, message: error.message.slice(0, 240), retryAt }); if (retryAt) await ctx.scheduler.runAt(retryAt, internal.publishing.processJob, { jobId });
    }
  },
});

export const checkInstagramStatus = internalAction({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, { jobId }) => {
    const bundle = await ctx.runQuery(internal.publishingData.getJobBundle, { jobId });
    if (!bundle || bundle.job.state !== "running" || bundle.destination.platform !== "instagram" || bundle.destination.status !== "processing") return;
    const containerId = bundle.destination.platformRequestId;
    if (!containerId) {
      await ctx.runMutation(internal.publishingData.markFailed, { jobId, code: "instagram_container_missing", message: "Instagram did not return a media container reference." });
      return;
    }
    const elapsed = Date.now() - bundle.job.createdAt;
    try {
      const credential = await ctx.runAction(internal.credentialVault.decrypt, { credentialId: bundle.account.credentialId });
      const result = await getInstagramContainerStatus(containerId, credential.accessToken);
      if (result.status_code === "FINISHED") {
        const published = await finalizeInstagramContainer(bundle.account.externalAccountId, containerId, credential.accessToken);
        await ctx.runMutation(internal.publishingData.markSucceeded, { jobId, ...published });
        return;
      }
      if (result.status_code === "ERROR" || result.status_code === "EXPIRED") {
        await ctx.runMutation(internal.publishingData.markFailed, {
          jobId,
          code: "container_failed",
          message: String(result.status ?? "Instagram could not prepare the media.").slice(0, 240),
        });
        return;
      }
      if (elapsed >= 10 * 60 * 1000) {
        await ctx.runMutation(internal.publishingData.markFailed, { jobId, code: "container_processing_timeout", message: "Instagram is taking longer than ten minutes to prepare this Reel." });
        return;
      }
      await ctx.runMutation(internal.publishingData.renewLease, { jobId, leaseExpiresAt: Date.now() + 10 * 60 * 1000 });
      await ctx.scheduler.runAfter(15_000, internal.publishing.checkInstagramStatus, { jobId });
    } catch (cause) {
      if (elapsed >= 10 * 60 * 1000) {
        const error = cause instanceof PublishError ? cause : new PublishError("instagram_status_unavailable", "Instagram's processing status could not be checked.");
        await ctx.runMutation(internal.publishingData.markFailed, { jobId, code: error.code, message: error.message.slice(0, 240) });
        return;
      }
      await ctx.runMutation(internal.publishingData.renewLease, { jobId, leaseExpiresAt: Date.now() + 10 * 60 * 1000 });
      await ctx.scheduler.runAfter(30_000, internal.publishing.checkInstagramStatus, { jobId });
    }
  },
});

export const checkTikTokStatus = internalAction({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, { jobId }) => {
    const bundle = await ctx.runQuery(internal.publishingData.getJobBundle, { jobId });
    if (!bundle || bundle.job.state !== "running" || bundle.destination.status !== "processing") return;
    const publishId = bundle.destination.platformRequestId;
    if (!publishId) {
      await ctx.runMutation(internal.publishingData.markFailed, { jobId, code: "tiktok_publish_id_missing", message: "TikTok did not return a publishing reference." });
      return;
    }
    try {
      const credential = await ctx.runAction(internal.credentialVault.decrypt, { credentialId: bundle.account.credentialId });
      await reservePlatformCall(ctx, bundle, "status_fetch", 30, 60_000);
      const result = await fetchTikTokStatus(publishId, credential.accessToken);
      const options = bundle.destination.options;
      const deliveryMode = options.kind === "tiktok" ? options.deliveryMode ?? "direct" : "direct";
      const outcome = classifyTikTokStatus(result.data ?? {}, bundle.job.createdAt, Date.now(), deliveryMode);
      if (outcome.kind === "published") {
        await ctx.runMutation(internal.publishingData.markSucceeded, { jobId, platformRequestId: publishId, liveUrl: tiktokLiveUrl(outcome.postId, bundle.account.handle) });
        return;
      }
      if (outcome.kind === "sent_to_inbox") {
        // A draft has no public URL; the creator finishes and posts it inside TikTok.
        await ctx.runMutation(internal.publishingData.markSucceeded, { jobId, platformRequestId: publishId });
        return;
      }
      if (outcome.kind === "failed") {
        await ctx.runMutation(internal.publishingData.markFailed, { jobId, code: outcome.reason, message: "TikTok could not publish this video." });
        return;
      }
      if (outcome.kind === "timed_out") {
        await ctx.runMutation(internal.publishingData.markFailed, { jobId, code: "tiktok_status_timeout", message: "TikTok is taking longer than expected to confirm this post." });
        return;
      }
      await ctx.scheduler.runAfter(15_000, internal.publishing.checkTikTokStatus, { jobId });
    } catch (cause) {
      if (Date.now() - bundle.job.createdAt > 10 * 60 * 1000) {
        const error = cause instanceof PublishError ? cause : new PublishError("tiktok_status_unavailable", "TikTok status could not be checked.");
        await ctx.runMutation(internal.publishingData.markFailed, { jobId, code: error.code, message: error.message.slice(0, 240) });
      } else {
        await ctx.scheduler.runAfter(30_000, internal.publishing.checkTikTokStatus, { jobId });
      }
    }
  },
});

export const recoverExpiredLeases = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.runQuery(internal.publishingData.listExpiredLeases, { now });
    for (const { job, destination } of expired) {
      if (destination?.platform === "tiktok" && destination.status === "processing") {
        await ctx.runMutation(internal.publishingData.renewLease, { jobId: job._id, leaseExpiresAt: now + 10 * 60 * 1000 });
        await ctx.scheduler.runAfter(0, internal.publishing.checkTikTokStatus, { jobId: job._id });
        continue;
      }
      const retryAt = job.attemptCount < 3 ? now : undefined;
      await ctx.runMutation(internal.publishingData.markFailed, {
        jobId: job._id,
        code: "worker_interrupted",
        message: retryAt ? "Publishing was interrupted and will resume safely." : "Publishing could not finish after several interrupted attempts.",
        retryAt,
      });
      if (retryAt) await ctx.scheduler.runAt(retryAt, internal.publishing.processJob, { jobId: job._id });
    }
  },
});
