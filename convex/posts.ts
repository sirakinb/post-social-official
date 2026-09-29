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
import { paginationOptsValidator } from "convex/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { captionProblems, planCaptionEdit } from "./lib/captionEdit";
import { statusesForGroup } from "./lib/postFilters";
import type { PostState } from "./lib/postState";

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

const statusGroupArg = v.union(v.literal("all"), v.literal("upcoming"), v.literal("published"), v.literal("attention"), v.literal("drafts"));

// A post with its destinations and media (with playable URLs), as the app shows it.
async function hydratePost(ctx: QueryCtx, post: Doc<"posts">) {
  return {
    ...post,
    destinations: await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", post._id)).collect(),
    media: (await Promise.all(post.mediaAssetIds.map(async (mediaId) => {
      const asset = await ctx.db.get(mediaId);
      return asset ? { ...asset, url: await ctx.storage.getUrl(asset.storageId) } : null;
    }))).filter((asset) => asset !== null),
  };
}

// Every post, newest first, a page at a time, so history is not capped at the latest 100.
export const listPage = query({
  args: { workspaceId: v.id("workspaces"), paginationOpts: paginationOptsValidator, statusGroup: v.optional(statusGroupArg) },
  handler: async (ctx, { workspaceId, paginationOpts, statusGroup }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const statuses = statusesForGroup(statusGroup);
    const base = ctx.db.query("posts").withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspaceId)).order("desc");
    const filtered = statuses ? base.filter((q) => q.or(...statuses.map((status) => q.eq(q.field("status"), status)))) : base;
    const result = await filtered.paginate(paginationOpts);
    return { ...result, page: await Promise.all(result.page.map((post) => hydratePost(ctx, post))) };
  },
});

// One post by id, for the preview page. Returns null (never throws) for a malformed or foreign id.
export const getForPreview = query({
  args: { workspaceId: v.id("workspaces"), postId: v.string() },
  handler: async (ctx, { workspaceId, postId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const id = ctx.db.normalizeId("posts", postId);
    if (!id) return null;
    const post = await ctx.db.get(id);
    if (!post || post.workspaceId !== workspaceId) return null;
    return await hydratePost(ctx, post);
  },
});

// Posts scheduled inside a window, for the calendar month view.
export const listInRange = query({
  args: { workspaceId: v.id("workspaces"), from: v.number(), to: v.number() },
  handler: async (ctx, { workspaceId, from, to }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const posts = await ctx.db.query("posts")
      .withIndex("by_workspace_schedule", (q) => q.eq("workspaceId", workspaceId).gte("scheduledAt", from).lt("scheduledAt", to))
      .take(500);
    return await Promise.all(posts.map(async (post) => ({
      _id: post._id,
      caption: post.caption,
      status: post.status,
      scheduledAt: post.scheduledAt,
      destinations: (await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", post._id)).collect()).map((destination) => ({ platform: destination.platform })),
    })));
  },
});

export const updateCaption = mutation({
  args: { workspaceId: v.id("workspaces"), postId: v.id("posts"), caption: v.string() },
  handler: async (ctx, args) => {
    const { user, membership } = await requireWorkspaceMember(ctx, args.workspaceId);
    const post = await ctx.db.get(args.postId);
    if (!post || post.workspaceId !== args.workspaceId) throw new Error("Post not found.");
    const mayManage = post.createdBy === user._id || membership.role === "owner" || membership.role === "admin";
    if (!mayManage) throw new Error("You do not have permission to edit this post.");

    const caption = args.caption.trim();
    const destinations = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", post._id)).collect();
    const problems = captionProblems(caption, destinations);
    if (problems.length > 0) throw new Error(problems[0]);

    const jobs = (await Promise.all(destinations.map((destination) => ctx.db.query("publishJobs").withIndex("by_destination", (q) => q.eq("destinationId", destination._id)).collect()))).flat();
    const sending = destinations.some((destination) => ["uploading", "processing"].includes(destination.status)) || jobs.some((job) => job.state === "running");
    const plan = planCaptionEdit({ status: post.status, policy: post.effectiveApprovalPolicy, sending });
    if (plan.kind === "blocked") throw new Error(plan.reason);
    if (caption === post.caption) return { status: post.status, needsReapproval: false, changed: false };

    const now = Date.now();
    if (plan.kind === "in_place") {
      await ctx.db.patch(post._id, { caption, updatedAt: now });
    } else {
      // A human approved the old wording. Stop the queued sends and ask for approval again.
      assertPostTransition(post.status as PostState, "awaiting_approval");
      for (const job of jobs) if (["queued", "retry_wait"].includes(job.state)) await ctx.db.patch(job._id, { state: "cancelled", updatedAt: now });
      await ctx.db.patch(post._id, { caption, status: "awaiting_approval", requestedAt: now, approvedAt: undefined, updatedAt: now });
      for (const destination of destinations) await ctx.db.patch(destination._id, { status: "awaiting_approval", updatedAt: now });
      await ctx.db.insert("approvalRequests", { workspaceId: args.workspaceId, postId: post._id, policy: post.effectiveApprovalPolicy, status: "pending", requestedBy: user._id, requestedAt: now });
    }
    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: user._id,
      entryPoint: "ui",
      eventType: "post.caption_edited",
      entityType: "post",
      entityId: post._id,
      summary: plan.kind === "reapproval" ? "Caption edited; the post was sent back for approval" : "Caption edited",
      safeMetadata: { reapproval: plan.kind === "reapproval", length: caption.length },
      occurredAt: now,
    });
    return { status: plan.kind === "reapproval" ? "awaiting_approval" : post.status, needsReapproval: plan.kind === "reapproval", changed: true };
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
