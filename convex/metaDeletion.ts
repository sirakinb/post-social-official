import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const process = internalMutation({
  args: { externalUserId: v.string(), externalUserHash: v.string(), confirmationCode: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requestId = await ctx.db.insert("dataDeletionRequests", { provider: "meta", confirmationCode: args.confirmationCode, externalUserHash: args.externalUserHash, status: "processing", removedAccounts: 0, requestedAt: now });
    try {
      const owned = await ctx.db.query("connectedAccounts").withIndex("by_owner_external", (q) => q.eq("ownerExternalId", args.externalUserId)).collect();
      const instagram = await ctx.db.query("connectedAccounts").withIndex("by_platform_external", (q) => q.eq("platform", "instagram").eq("externalAccountId", args.externalUserId)).collect();
      const accounts = [...new Map([...owned, ...instagram].map((account) => [account._id, account])).values()];
      const affectedPosts = new Set<string>();
      for (const account of accounts) {
        const destinations = await ctx.db.query("destinations").withIndex("by_account", (q) => q.eq("connectedAccountId", account._id)).collect();
        for (const destination of destinations) {
          affectedPosts.add(destination.postId);
          const jobs = await ctx.db.query("publishJobs").withIndex("by_destination", (q) => q.eq("destinationId", destination._id)).collect();
          for (const job of jobs) await ctx.db.delete(job._id);
          await ctx.db.delete(destination._id);
        }
        const credential = await ctx.db.get(account.credentialId);
        if (credential) await ctx.db.delete(credential._id);
        await ctx.db.delete(account._id);
      }
      for (const postIdValue of affectedPosts) {
        const postId = postIdValue as any;
        const remaining = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
        if (remaining.length) continue;
        const post = await ctx.db.get(postId);
        if (!post) continue;
        const approvals = await ctx.db.query("approvals").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
        for (const approval of approvals) await ctx.db.delete(approval._id);
        const approvalRequests = await ctx.db.query("approvalRequests").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
        for (const request of approvalRequests) await ctx.db.delete(request._id);
        await ctx.db.delete(postId);
      }
      await ctx.db.patch(requestId, { status: "completed", removedAccounts: accounts.length, completedAt: Date.now() });
      return { status: "completed" as const, removedAccounts: accounts.length };
    } catch (error) {
      await ctx.db.patch(requestId, { status: "failed", completedAt: Date.now() });
      throw error;
    }
  },
});

export const status = internalQuery({
  args: { confirmationCode: v.string() },
  handler: async (ctx, { confirmationCode }) => {
    const request = await ctx.db.query("dataDeletionRequests").withIndex("by_confirmation_code", (q) => q.eq("confirmationCode", confirmationCode)).unique();
    return request ? { status: request.status, removedAccounts: request.removedAccounts, requestedAt: request.requestedAt, completedAt: request.completedAt } : null;
  },
});

export const purgeExpiredReceipts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const expired = await ctx.db.query("dataDeletionRequests").withIndex("by_requested_at", (q) => q.lt("requestedAt", cutoff)).take(200);
    for (const request of expired) await ctx.db.delete(request._id);
    return { removed: expired.length };
  },
});
