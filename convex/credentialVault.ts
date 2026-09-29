"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { platform } from "./model";
import { openCredential, parseEncryptionKey, sealCredential } from "./lib/credentialCrypto";
import type { Id } from "./_generated/dataModel";

export const encryptAndStore = internalAction({
  args: {
    credentialId: v.optional(v.id("oauthCredentials")),
    workspaceId: v.id("workspaces"),
    platform,
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    refreshTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"oauthCredentials">> => {
    const sealed = sealCredential(
      { accessToken: args.accessToken, refreshToken: args.refreshToken },
      parseEncryptionKey(process.env.CREDENTIAL_ENCRYPTION_KEY)
    );
    const credentialId = await ctx.runMutation(internal.credentials.storeEncrypted, {
      credentialId: args.credentialId,
      workspaceId: args.workspaceId,
      platform: args.platform,
      encryptedPayload: sealed.encryptedPayload,
      initializationVector: sealed.initializationVector,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      refreshTokenExpiresAt: args.refreshTokenExpiresAt,
    });
    return credentialId;
  },
});

export const decrypt = internalAction({
  args: { credentialId: v.id("oauthCredentials") },
  handler: async (ctx, { credentialId }): Promise<{ accessToken: string; refreshToken?: string }> => {
    const record = await ctx.runQuery(internal.credentials.readEncrypted, { credentialId });
    if (!record) throw new Error("Credential record not found.");
    if (record.algorithm !== "AES-256-GCM" || record.keyVersion !== 1) throw new Error("Unsupported credential encryption version.");
    return openCredential(
      {
        encryptedPayload: record.encryptedPayload,
        initializationVector: record.initializationVector,
      },
      parseEncryptionKey(process.env.CREDENTIAL_ENCRYPTION_KEY)
    );
  },
});
