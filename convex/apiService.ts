import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { destinationOptions, entryPoint } from "./model";
import { createDraftCore, requestPublishCore } from "./lib/postService";
import { saveMediaCore } from "./lib/mediaService";

const destinationInput = v.object({
  connectedAccountId: v.id("connectedAccounts"),
  options: destinationOptions,
});

export const authenticate = internalMutation({
  args: { keyHash: v.string(), requiredScope: v.string() },
  handler: async (ctx, { keyHash, requiredScope }) => {
    const key = await ctx.db.query("apiKeys").withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash)).unique();
    if (!key || key.revokedAt) return null;
    if (!key.scopes.includes(requiredScope)) return null;
    const membership = await ctx.db.query("workspaceMembers").withIndex("by_workspace_user", (q) => q.eq("workspaceId", key.workspaceId).eq("userId", key.createdBy)).unique();
    if (!membership) return null;
    const now = Date.now();
    const windowStartedAt = key.requestWindowStartedAt ?? now;
    const inCurrentWindow = now - windowStartedAt < 60_000;
    const requestCount = inCurrentWindow ? (key.requestCount ?? 0) + 1 : 1;
    if (inCurrentWindow && requestCount > 120) throw new Error("API_RATE_LIMITED");
    await ctx.db.patch(key._id, { lastUsedAt: now, requestWindowStartedAt: inCurrentWindow ? windowStartedAt : now, requestCount });
    return { workspaceId: key.workspaceId, userId: key.createdBy, keyId: key._id, scopes: key.scopes };
  },
});

export const listAccounts = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const accounts = await ctx.db.query("connectedAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    return accounts.map(({ credentialId: _credentialId, ...account }) => account);
  },
});

export const listPosts = internalQuery({
  args: { workspaceId: v.id("workspaces"), limit: v.number() },
  handler: async (ctx, { workspaceId, limit }) => {
    const posts = await ctx.db.query("posts").withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspaceId)).order("desc").take(Math.min(Math.max(limit, 1), 100));
    return await Promise.all(posts.map(async (post) => ({
      ...post,
      destinations: await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", post._id)).collect(),
    })));
  },
});

export const getPost = internalQuery({
  args: { workspaceId: v.id("workspaces"), postId: v.id("posts") },
  handler: async (ctx, { workspaceId, postId }) => {
    const post = await ctx.db.get(postId);
    if (!post || post.workspaceId !== workspaceId) return null;
    const destinations = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    const approvals = await ctx.db.query("approvals").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    const approvalRequests = await ctx.db.query("approvalRequests").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    return { ...post, destinations, approvals, approvalRequests };
  },
});

export const prepareUpload = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx) => ({ uploadUrl: await ctx.storage.generateUploadUrl() }),
});

export const finalizeUpload = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    mediaType: v.union(v.literal("video"), v.literal("image")),
    sizeBytes: v.number(),
    durationSeconds: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => await saveMediaCore(ctx, args),
});

export const createDraft = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    caption: v.string(),
    mediaAssetIds: v.array(v.id("mediaAssets")),
    scheduledAt: v.optional(v.number()),
    entryPoint,
    destinations: v.array(destinationInput),
  },
  handler: async (ctx, args) => await createDraftCore(ctx, args),
});

export const setSchedule = internalMutation({
  args: { workspaceId: v.id("workspaces"), postId: v.id("posts"), scheduledAt: v.number(), entryPoint },
  handler: async (ctx, { workspaceId, postId, scheduledAt, entryPoint }) => {
    const post = await ctx.db.get(postId);
    if (!post || post.workspaceId !== workspaceId) throw new Error("Post not found.");
    if (post.status !== "draft") throw new Error("Only a draft can be scheduled.");
    if (scheduledAt < Date.now() + 60_000) throw new Error("Choose a publishing time at least one minute from now.");
    const now = Date.now();
    await ctx.db.patch(postId, { scheduledAt, entryPoint, updatedAt: now });
    return { postId, scheduledAt, status: "draft" };
  },
});

export const requestPublish = internalMutation({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users"), postId: v.id("posts"), entryPoint },
  handler: async (ctx, args) => await requestPublishCore(ctx, args),
});

export const cancelScheduled = internalMutation({
  args: { workspaceId: v.id("workspaces"), postId: v.id("posts"), userId: v.id("users"), entryPoint },
  handler: async (ctx, { workspaceId, postId, userId, entryPoint }) => {
    const post = await ctx.db.get(postId);
    if (!post || post.workspaceId !== workspaceId) throw new Error("Post not found.");
    if (!["scheduled", "approved", "awaiting_approval"].includes(post.status)) throw new Error("Only a scheduled or approval-pending post can be cancelled.");
    const now = Date.now();
    const destinations = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    for (const destination of destinations) {
      await ctx.db.patch(destination._id, { status: "cancelled", updatedAt: now });
      const jobs = await ctx.db.query("publishJobs").withIndex("by_destination", (q) => q.eq("destinationId", destination._id)).collect();
      for (const job of jobs) if (!["complete", "failed"].includes(job.state)) await ctx.db.patch(job._id, { state: "cancelled", updatedAt: now });
    }
    const requests = await ctx.db.query("approvalRequests").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    for (const request of requests) if (request.status === "pending") await ctx.db.patch(request._id, { status: "cancelled", closedAt: now });
    await ctx.db.patch(postId, { status: "cancelled", entryPoint, updatedAt: now });
    await ctx.db.insert("auditEvents", { workspaceId, actorUserId: userId, entryPoint, eventType: "post.cancelled", entityType: "post", entityId: postId, summary: "Scheduled post cancelled by developer integration", occurredAt: now });
    return { postId, status: "cancelled" };
  },
});
