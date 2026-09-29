import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

function settingsMetadata(options: any): Record<string, string | number | boolean> {
  if (options.kind === "tiktok") return {
    privacyLevel: options.privacyLevel,
    commentEnabled: options.commentEnabled,
    duetEnabled: options.duetEnabled,
    stitchEnabled: options.stitchEnabled,
    disclosureEnabled: options.disclosureEnabled,
    yourBrandEnabled: options.yourBrandEnabled,
    brandedContentEnabled: options.brandedContentEnabled,
    aiGenerated: options.aiGenerated ?? false,
    deliveryMode: options.deliveryMode ?? "direct",
  };
  if (options.kind === "youtube") return {
    privacyStatus: options.privacyStatus,
    hasCustomDescription: Boolean(options.description),
  };
  return { mediaType: options.mediaType };
}

export const getJobBundle = internalQuery({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId); if (!job) return null;
    const destination = await ctx.db.get(job.destinationId); if (!destination) return null;
    const post = await ctx.db.get(job.postId); if (!post) return null;
    const account = await ctx.db.get(destination.connectedAccountId); if (!account) return null;
    const media = await Promise.all(post.mediaAssetIds.map(async id => { const asset = await ctx.db.get(id); if (!asset) return null; return { ...asset, url: await ctx.storage.getUrl(asset.storageId) }; }));
    return { job, destination, post, account, media: media.filter(item => item !== null) };
  },
});

export const updateYouTubeIdentity = internalMutation({
  args: {
    accountId: v.id("connectedAccounts"),
    channelId: v.optional(v.string()),
    channelTitle: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, channelId, channelTitle }) => {
    const account = await ctx.db.get(accountId);
    if (!account || account.platform !== "youtube") return;
    // externalAccountId stays workspace-keyed so reconnects find this row;
    // the real channel id lives in ownerExternalId.
    const patch: Partial<typeof account> = { updatedAt: Date.now() };
    if (channelTitle) {
      patch.displayName = channelTitle;
      patch.handle = channelTitle;
    }
    if (channelId) patch.ownerExternalId = channelId;
    await ctx.db.patch(accountId, patch);
  },
});

export const getAccount = internalQuery({
  args: { workspaceId: v.id("workspaces"), accountId: v.id("connectedAccounts") },
  handler: async (ctx, args) => { const account = await ctx.db.get(args.accountId); return account?.workspaceId === args.workspaceId ? account : null; },
});

export const listExpiredLeases = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const running = await ctx.db.query("publishJobs").withIndex("by_state_next_attempt", (q) => q.eq("state", "running")).collect();
    const expired = running.filter((job) => job.leaseExpiresAt !== undefined && job.leaseExpiresAt < now);
    return await Promise.all(expired.map(async (job) => ({ job, destination: await ctx.db.get(job.destinationId) })));
  },
});

export const renewLease = internalMutation({
  args: { jobId: v.id("publishJobs"), leaseExpiresAt: v.number() },
  handler: async (ctx, { jobId, leaseExpiresAt }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "running") return false;
    await ctx.db.patch(jobId, { leaseExpiresAt, updatedAt: Date.now() });
    return true;
  },
});

export const markRunning = internalMutation({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId); if (!job || !["queued", "retry_wait"].includes(job.state)) return false;
    const now = Date.now();
    const attemptCount = job.attemptCount + 1;
    await ctx.db.patch(jobId, { state: "running", attemptCount, leaseExpiresAt: now + 15 * 60 * 1000, updatedAt: now });
    await ctx.db.patch(job.destinationId, { status: "uploading", updatedAt: now });
    await ctx.db.patch(job.postId, { status: "processing", updatedAt: now });
    const destination = await ctx.db.get(job.destinationId);
    const post = await ctx.db.get(job.postId);
    const account = destination ? await ctx.db.get(destination.connectedAccountId) : null;
    if (destination && post && account) {
      await ctx.db.insert("auditEvents", {
        workspaceId: job.workspaceId,
        actorUserId: post.createdBy,
        entryPoint: post.entryPoint,
        eventType: "destination.publish_attempted",
        entityType: "destination",
        entityId: destination._id,
        summary: `${destination.platform} publishing attempt started`,
        safeMetadata: {
          attemptCount,
          scopes: account.scopes.join(","),
          consentedAt: destination.consentedAt ?? 0,
          ...(destination.platformRequestId ? { platformRequestId: destination.platformRequestId } : {}),
          ...settingsMetadata(destination.options),
        },
        occurredAt: now,
      });
    }
    return true;
  },
});

export const markSubmitted = internalMutation({
  args: { jobId: v.id("publishJobs"), platformRequestId: v.string() },
  handler: async (ctx, { jobId, platformRequestId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "running") return false;
    const now = Date.now();
    await ctx.db.patch(job.destinationId, {
      status: "processing",
      platformRequestId,
      sanitizedErrorCode: undefined,
      sanitizedErrorMessage: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, { leaseExpiresAt: now + 10 * 60 * 1000, updatedAt: now });
    const destination = await ctx.db.get(job.destinationId);
    const post = await ctx.db.get(job.postId);
    const account = destination ? await ctx.db.get(destination.connectedAccountId) : null;
    if (destination && post && account) {
      await ctx.db.insert("auditEvents", {
        workspaceId: job.workspaceId,
        actorUserId: post.createdBy,
        entryPoint: post.entryPoint,
        eventType: "destination.submitted",
        entityType: "destination",
        entityId: destination._id,
        summary: `${destination.platform} accepted the publishing request`,
        safeMetadata: {
          platformRequestId,
          scopes: account.scopes.join(","),
          consentedAt: destination.consentedAt ?? 0,
          ...settingsMetadata(destination.options),
        },
        occurredAt: now,
      });
    }
    return true;
  },
});

export const markSucceeded = internalMutation({
  args: { jobId: v.id("publishJobs"), platformRequestId: v.optional(v.string()), liveUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId); if (!job) return;
    const now = Date.now(); await ctx.db.patch(job._id, { state: "complete", leaseExpiresAt: undefined, updatedAt: now });
    await ctx.db.patch(job.destinationId, { status: "published", platformRequestId: args.platformRequestId, liveUrl: args.liveUrl, sanitizedErrorCode: undefined, sanitizedErrorMessage: undefined, updatedAt: now });
    const destinations = await ctx.db.query("destinations").withIndex("by_post", q => q.eq("postId", job.postId)).collect();
    const statuses = destinations.map(d => d._id === job.destinationId ? "published" : d.status);
    const finalStatus = statuses.every(s => s === "published") ? "published" : statuses.some(s => ["queued", "uploading", "processing", "scheduled"].includes(s)) ? "processing" : statuses.some(s => s === "published") ? "partially_published" : "failed";
    await ctx.db.patch(job.postId, { status: finalStatus, updatedAt: now });
    const destination = await ctx.db.get(job.destinationId);
    const post = await ctx.db.get(job.postId);
    await ctx.db.insert("auditEvents", { workspaceId: job.workspaceId, actorUserId: post?.createdBy, entryPoint: post?.entryPoint ?? "ui", eventType: "destination.published", entityType: "destination", entityId: job.destinationId, summary: "Destination published successfully", safeMetadata: { attemptCount: job.attemptCount, platformRequestId: args.platformRequestId ?? destination?.platformRequestId ?? "", liveUrl: args.liveUrl ?? "" }, occurredAt: now });
    if (destination && post) await ctx.scheduler.runAfter(0, internal.webhooks.enqueue, {
      workspaceId: job.workspaceId,
      event: "destination.published",
      payloadJson: JSON.stringify({ id: `evt_${job.destinationId}_${now}`, event: "destination.published", created_at: now, data: { post_id: post._id, destination_id: destination._id, platform: destination.platform, status: "published", live_url: args.liveUrl ?? destination.liveUrl ?? null } }),
    });
  },
});

export const markFailed = internalMutation({
  args: { jobId: v.id("publishJobs"), code: v.string(), message: v.string(), retryAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId); if (!job) return;
    const now = Date.now();
    if (args.retryAt) { await ctx.db.patch(job._id, { state: "retry_wait", nextAttemptAt: args.retryAt, leaseExpiresAt: undefined, updatedAt: now }); await ctx.db.patch(job.destinationId, { status: "queued", sanitizedErrorCode: args.code, sanitizedErrorMessage: args.message, updatedAt: now }); }
    else {
      await ctx.db.patch(job._id, { state: "failed", leaseExpiresAt: undefined, updatedAt: now }); await ctx.db.patch(job.destinationId, { status: "failed", sanitizedErrorCode: args.code, sanitizedErrorMessage: args.message, updatedAt: now });
      const destinations = await ctx.db.query("destinations").withIndex("by_post", q => q.eq("postId", job.postId)).collect(); const anyPublished = destinations.some(d => d.status === "published"); const anyActive = destinations.some(d => d._id !== job.destinationId && ["queued", "uploading", "processing", "scheduled"].includes(d.status));
      await ctx.db.patch(job.postId, { status: anyActive ? "processing" : anyPublished ? "partially_published" : "failed", updatedAt: now });
    }
    const post = await ctx.db.get(job.postId);
    await ctx.db.insert("auditEvents", { workspaceId: job.workspaceId, actorUserId: post?.createdBy, entryPoint: post?.entryPoint ?? "ui", eventType: args.retryAt ? "destination.retry_scheduled" : "destination.failed", entityType: "destination", entityId: job.destinationId, summary: args.retryAt ? "Publishing retry scheduled" : "Destination publishing failed", safeMetadata: { code: args.code, attemptCount: job.attemptCount }, occurredAt: now });
    if (!args.retryAt) {
      const destination = await ctx.db.get(job.destinationId);
      if (destination && post) await ctx.scheduler.runAfter(0, internal.webhooks.enqueue, {
        workspaceId: job.workspaceId,
        event: "destination.failed",
        payloadJson: JSON.stringify({ id: `evt_${job.destinationId}_${now}`, event: "destination.failed", created_at: now, data: { post_id: post._id, destination_id: destination._id, platform: destination.platform, status: "failed", error: { code: args.code, message: args.message } } }),
      });
    }
  },
});
