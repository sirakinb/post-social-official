import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { platform } from "./model";

const oauthProvider = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("facebook"),
  v.literal("threads"),
  v.literal("youtube")
);

export const create = internalMutation({
  args: { workspaceId: v.id("workspaces"), identitySubject: v.string(), provider: oauthProvider, stateHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => await ctx.db.insert("oauthStates", { ...args, createdAt: Date.now() }),
});

export const consume = internalMutation({
  args: { stateHash: v.string(), provider: oauthProvider },
  handler: async (ctx, { stateHash, provider }) => {
    const record = await ctx.db.query("oauthStates").withIndex("by_state_hash", q => q.eq("stateHash", stateHash)).unique();
    if (!record || record.provider !== provider || record.usedAt || record.expiresAt < Date.now()) return null;
    await ctx.db.patch(record._id, { usedAt: Date.now() });
    return { workspaceId: record.workspaceId, identitySubject: record.identitySubject };
  },
});

// Whether this app started the sign-in with this state (used or not). Sign-ins it doesn't
// know came from the new InsForge app and are forwarded there.
export const isKnown = internalQuery({
  args: { stateHash: v.string() },
  handler: async (ctx, { stateHash }) => (await ctx.db.query("oauthStates").withIndex("by_state_hash", q => q.eq("stateHash", stateHash)).unique()) !== null,
});

export const existingAccount = internalQuery({
  args: { platform, externalAccountId: v.string() },
  handler: async (ctx, args) => await ctx.db.query("connectedAccounts").withIndex("by_platform_external", q => q.eq("platform", args.platform).eq("externalAccountId", args.externalAccountId)).unique(),
});

export const upsertAccount = internalMutation({
  args: {
    workspaceId: v.id("workspaces"), platform, externalAccountId: v.string(), handle: v.string(), displayName: v.string(), avatarUrl: v.optional(v.string()), scopes: v.array(v.string()), credentialId: v.id("oauthCredentials"), linkedFacebookPageId: v.optional(v.string()), ownerExternalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("connectedAccounts").withIndex("by_platform_external", q => q.eq("platform", args.platform).eq("externalAccountId", args.externalAccountId)).unique();
    if (existing && existing.workspaceId !== args.workspaceId) throw new Error("This social account is already connected to another workspace.");
    const now = Date.now();
    const values = { ...args, health: "connected" as const, healthReason: undefined, disconnectedAt: undefined, lastVerifiedAt: now, updatedAt: now };
    if (existing) { await ctx.db.patch(existing._id, values); return existing._id; }
    const accountId = await ctx.db.insert("connectedAccounts", { ...values, createdAt: now });
    await ctx.db.insert("auditEvents", { workspaceId: args.workspaceId, entryPoint: "ui", eventType: "account.connected", entityType: "account", entityId: accountId, summary: `${args.platform} account connected`, safeMetadata: { platform: args.platform }, occurredAt: now });
    return accountId;
  },
});
