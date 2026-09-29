import { internalMutation } from "./_generated/server";

export const purgeExpiredEphemera = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiredStates = await ctx.db.query("oauthStates").withIndex("by_expires_at", (q) => q.lt("expiresAt", now - 24 * 60 * 60 * 1000)).take(200);
    for (const state of expiredStates) await ctx.db.delete(state._id);
    const staleLimits = await ctx.db.query("platformRateLimits").withIndex("by_updated_at", (q) => q.lt("updatedAt", now - 30 * 24 * 60 * 60 * 1000)).take(200);
    for (const limit of staleLimits) await ctx.db.delete(limit._id);
    return { removedOauthStates: expiredStates.length, removedRateLimits: staleLimits.length };
  },
});
