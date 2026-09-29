import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { platform } from "./model";
import { rateWindowStart } from "./lib/platformRules";

export const reserve = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    connectedAccountId: v.id("connectedAccounts"),
    platform,
    operation: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = rateWindowStart(now, args.windowMs);
    const record = await ctx.db
      .query("platformRateLimits")
      .withIndex("by_account_operation_window", (q) => q
        .eq("connectedAccountId", args.connectedAccountId)
        .eq("operation", args.operation)
        .eq("windowStart", windowStart))
      .unique();
    if (record && record.count >= args.limit) return { allowed: false, retryAt: windowStart + args.windowMs };
    if (record) await ctx.db.patch(record._id, { count: record.count + 1, updatedAt: now });
    else await ctx.db.insert("platformRateLimits", { workspaceId: args.workspaceId, connectedAccountId: args.connectedAccountId, platform: args.platform, operation: args.operation, windowStart, count: 1, updatedAt: now });
    return { allowed: true, retryAt: windowStart + args.windowMs };
  },
});
