import { mutation, query } from "./_generated/server";
import { requireCurrentUser } from "./lib/access";

export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in is required.");
    const existing = await ctx.db
      .query("users")
      .withIndex("by_identity_subject", (q) => q.eq("identitySubject", identity.tokenIdentifier))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        email: identity.email,
        name: identity.name,
        lastSeenAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("users", {
      identitySubject: identity.tokenIdentifier,
      email: identity.email,
      name: identity.name,
      lastSeenAt: now,
    });
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_identity_subject", (q) => q.eq("identitySubject", identity.tokenIdentifier))
      .unique();
  },
});

export const deleteEmptyProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (memberships.length > 0) throw new Error("Delete your workspaces before deleting your sign-in.");
    await ctx.db.delete(user._id);
    return { deleted: true };
  },
});
