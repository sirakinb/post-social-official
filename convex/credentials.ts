import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { platform } from "./model";

export const storeEncrypted = internalMutation({
  args: {
    credentialId: v.optional(v.id("oauthCredentials")),
    workspaceId: v.id("workspaces"),
    platform,
    encryptedPayload: v.string(),
    initializationVector: v.string(),
    accessTokenExpiresAt: v.optional(v.number()),
    refreshTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const record = {
      workspaceId: args.workspaceId,
      platform: args.platform,
      encryptedPayload: args.encryptedPayload,
      initializationVector: args.initializationVector,
      algorithm: "AES-256-GCM" as const,
      keyVersion: 1,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      refreshTokenExpiresAt: args.refreshTokenExpiresAt,
      updatedAt: Date.now(),
    };
    if (args.credentialId) {
      const existing = await ctx.db.get(args.credentialId);
      if (existing) {
        if (existing.workspaceId !== args.workspaceId || existing.platform !== args.platform) throw new Error("Credential record mismatch.");
        await ctx.db.patch(args.credentialId, record);
        return args.credentialId;
      }
    }
    return await ctx.db.insert("oauthCredentials", record);
  },
});

export const readEncrypted = internalQuery({
  args: { credentialId: v.id("oauthCredentials") },
  handler: async (ctx, { credentialId }) => await ctx.db.get(credentialId),
});

export const expiringBefore = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, { before }) => await ctx.db
    .query("oauthCredentials")
    .withIndex("by_access_expiry", (q) => q.gt("accessTokenExpiresAt", 0).lt("accessTokenExpiresAt", before))
    .collect(),
});

export const accountForCredential = internalQuery({
  args: { credentialId: v.id("oauthCredentials") },
  handler: async (ctx, { credentialId }) => await ctx.db
    .query("connectedAccounts")
    .withIndex("by_credential", (q) => q.eq("credentialId", credentialId))
    .unique(),
});

export const markRefreshFailed = internalMutation({
  args: { credentialId: v.id("oauthCredentials"), reason: v.string() },
  handler: async (ctx, { credentialId, reason }) => {
    const account = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_credential", (q) => q.eq("credentialId", credentialId))
      .unique();
    if (!account || account.health === "disconnected") return;
    const now = Date.now();
    await ctx.db.patch(account._id, { health: "needs_attention", healthReason: reason, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: account.workspaceId,
      entryPoint: "ui",
      eventType: "account.token_refresh_failed",
      entityType: "account",
      entityId: account._id,
      summary: `${account.platform} account needs to be reconnected`,
      safeMetadata: { platform: account.platform },
      occurredAt: now,
    });
  },
});

export const remove = internalMutation({
  args: { credentialId: v.id("oauthCredentials") },
  handler: async (ctx, { credentialId }) => {
    const credential = await ctx.db.get(credentialId);
    if (credential) await ctx.db.delete(credentialId);
  },
});
