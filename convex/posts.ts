import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { destinationOptions, entryPoint } from "./model";
import { requireWorkspaceMember, requireWorkspaceReviewer } from "./lib/access";
import {
  assertPostTransition,
  stateAfterApproval,
} from "./lib/postState";
import { internal } from "./_generated/api";
import { createDraftCore, requestPublishCore } from "./lib/postService";

const destinationInput = v.object({
  connectedAccountId: v.id("connectedAccounts"),
  options: destinationOptions,
});

export const createDraft = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    caption: v.string(),
    mediaAssetIds: v.array(v.id("mediaAssets")),
    scheduledAt: v.optional(v.number()),
    entryPoint,
    destinations: v.array(destinationInput),
  },
  handler: async (ctx, args) => {
    const { user } = await requireWorkspaceMember(ctx, args.workspaceId);
    const result = await createDraftCore(ctx, { ...args, userId: user._id });
    return result.postId;
  },
});

export const requestPublish = mutation({
  args: { workspaceId: v.id("workspaces"), postId: v.id("posts"), consented: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireWorkspaceMember(ctx, args.workspaceId);
    if (!args.consented) throw new Error("Please actively confirm before publishing.");
    const result = await requestPublishCore(ctx, { workspaceId: args.workspaceId, postId: args.postId, userId: user._id, entryPoint: "ui" });
    return { status: result.status };
  },
});

export const decideApproval = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    postId: v.id("posts"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireWorkspaceReviewer(ctx, args.workspaceId);
    const post = await ctx.db.get(args.postId);
    if (!post || post.workspaceId !== args.workspaceId || post.status !== "awaiting_approval") throw new Error("This post is not waiting for approval.");
    const request = await ctx.db.query("approvalRequests").withIndex("by_post", (q) => q.eq("postId", post._id)).filter((q) => q.eq(q.field("status"), "pending")).unique();
    if (!request) throw new Error("Pending approval not found.");
    const destinations = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", post._id)).collect();
    const now = Date.now();
    await ctx.db.patch(request._id, { status: "decided", closedAt: now });
    const approvalId = await ctx.db.insert("approvals", { workspaceId: args.workspaceId, postId: post._id, policy: request.policy, status: args.decision, requestedBy: request.requestedBy, decidedBy: user._id, requestedAt: request.requestedAt, decidedAt: now, note: args.note });
    if (args.decision === "rejected") {
      assertPostTransition("awaiting_approval", "draft");
      await ctx.db.patch(post._id, { status: "draft", updatedAt: now });
      for (const destination of destinations) await ctx.db.patch(destination._id, { status: "draft", consentedAt: undefined, updatedAt: now });
    } else {
      assertPostTransition("awaiting_approval", "approved");
      const nextState = stateAfterApproval(post.scheduledAt, now);
      assertPostTransition("approved", nextState);
      await ctx.db.patch(post._id, { status: nextState, approvedAt: now, updatedAt: now });
      for (const destination of destinations) {
        await ctx.db.patch(destination._id, { status: nextState === "scheduled" ? "scheduled" : "queued", updatedAt: now });
        const jobId = await ctx.db.insert("publishJobs", {
          workspaceId: args.workspaceId,
          postId: post._id,
          destinationId: destination._id,
          state: "queued",
          attemptCount: 0,
          nextAttemptAt: post.scheduledAt ?? now,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.scheduler.runAt(post.scheduledAt ?? now, internal.publishing.processJob, { jobId });
      }
    }
    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: user._id,
      entryPoint: "ui",
      eventType: `approval.${args.decision}`,
      entityType: "approval",
      entityId: approvalId,
      summary: args.decision === "approved" ? "Post approved for publishing" : "Post returned to draft",
      safeMetadata: args.note ? { hasNote: true } : undefined,
      occurredAt: now,
    });
    return { status: args.decision === "rejected" ? "draft" : stateAfterApproval(post.scheduledAt, now) };
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const posts = await ctx.db.query("posts").withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspaceId)).order("desc").take(100);
    return await Promise.all(posts.map(async (post) => ({
      ...post,
      destinations: await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", post._id)).collect(),
      media: (await Promise.all(post.mediaAssetIds.map(async (mediaId) => {
        const asset = await ctx.db.get(mediaId);
        return asset ? { ...asset, url: await ctx.storage.getUrl(asset.storageId) } : null;
      }))).filter((asset) => asset !== null),
    })));
  },
});

export const get = query({
  args: { workspaceId: v.id("workspaces"), postId: v.id("posts") },
  handler: async (ctx, { workspaceId, postId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const post = await ctx.db.get(postId);
    if (!post || post.workspaceId !== workspaceId) return null;
    const destinations = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    const approvals = await ctx.db.query("approvals").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    const approvalRequests = await ctx.db.query("approvalRequests").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    return { ...post, destinations, approvals, approvalRequests };
  },
});

export const deleteUnpublished = mutation({
  args: { workspaceId: v.id("workspaces"), postId: v.id("posts") },
  handler: async (ctx, { workspaceId, postId }) => {
    const { user, membership } = await requireWorkspaceMember(ctx, workspaceId);
    const post = await ctx.db.get(postId);
    if (!post || post.workspaceId !== workspaceId) throw new Error("Post not found.");
    const mayManage = post.createdBy === user._id || membership.role === "owner" || membership.role === "admin";
    if (!mayManage) throw new Error("You do not have permission to delete this post.");
    if (!["draft", "awaiting_approval", "approved", "scheduled", "failed", "cancelled"].includes(post.status)) {
      throw new Error("A post that is processing or already published cannot be deleted here.");
    }

    const destinations = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    for (const destination of destinations) {
      const jobs = await ctx.db.query("publishJobs").withIndex("by_destination", (q) => q.eq("destinationId", destination._id)).collect();
      for (const job of jobs) await ctx.db.delete(job._id);
      await ctx.db.delete(destination._id);
    }
    const approvals = await ctx.db.query("approvals").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    for (const approval of approvals) await ctx.db.delete(approval._id);
    const approvalRequests = await ctx.db.query("approvalRequests").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
    for (const request of approvalRequests) await ctx.db.delete(request._id);
    await ctx.db.delete(postId);

    const remainingPosts = await ctx.db.query("posts").withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const mediaId of post.mediaAssetIds) {
      if (remainingPosts.some((remaining) => remaining.mediaAssetIds.includes(mediaId))) continue;
      const asset = await ctx.db.get(mediaId);
      if (asset?.workspaceId === workspaceId) {
        await ctx.storage.delete(asset.storageId);
        await ctx.db.delete(mediaId);
      }
    }
    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: user._id,
      entryPoint: "ui",
      eventType: "post.deleted",
      entityType: "post",
      entityId: postId,
      summary: "Unpublished post deleted",
      safeMetadata: { priorStatus: post.status },
      occurredAt: Date.now(),
    });
    return { deleted: true };
  },
});
