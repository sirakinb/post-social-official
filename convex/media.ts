import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceMember } from "./lib/access";
import { mediaRemovalPlan } from "./lib/mediaRemoval";
import { saveMediaCore } from "./lib/mediaService";

export const generateUploadUrl = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveUploaded = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    mediaType: v.union(v.literal("video"), v.literal("image")),
    sizeBytes: v.number(),
    durationSeconds: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    checksumSha256: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireWorkspaceMember(ctx, args.workspaceId);
    const result = await saveMediaCore(ctx, { ...args, userId: user._id });
    return result.mediaId;
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const assets = await ctx.db.query("mediaAssets").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order("desc").collect();
    const visibleAssets = assets.filter((asset) => asset.hiddenFromLibraryAt === undefined).slice(0, 100);
    return await Promise.all(visibleAssets.map(async (asset) => ({ ...asset, url: await ctx.storage.getUrl(asset.storageId) })));
  },
});

export const deleteUnused = mutation({
  args: { workspaceId: v.id("workspaces"), mediaId: v.id("mediaAssets") },
  handler: async (ctx, { workspaceId, mediaId }) => {
    const { membership } = await requireWorkspaceMember(ctx, workspaceId);
    if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Owner or admin permission is required to delete media.");
    const asset = await ctx.db.get(mediaId);
    if (!asset || asset.workspaceId !== workspaceId) throw new Error("Media not found.");
    const posts = await ctx.db.query("posts").withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspaceId)).collect();
    const referenceCount = posts.filter((post) => post.mediaAssetIds.includes(mediaId)).length;
    const plan = mediaRemovalPlan(referenceCount);

    if (plan.action === "hide") {
      await ctx.db.patch(mediaId, { hiddenFromLibraryAt: Date.now() });
      return {
        deleted: false,
        removedFromLibrary: true,
        preservedPostReferences: plan.preservedPostReferences,
      };
    }

    await ctx.storage.delete(asset.storageId);
    await ctx.db.delete(mediaId);
    return {
      deleted: true,
      removedFromLibrary: true,
      preservedPostReferences: 0,
    };
  },
});
