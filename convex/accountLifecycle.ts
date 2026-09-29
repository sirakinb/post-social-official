"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { revokePlatformCredential } from "./lib/platformRevocation";

export const disconnect = action({
  args: { workspaceId: v.id("workspaces"), accountId: v.id("connectedAccounts") },
  handler: async (ctx, args): Promise<{ disconnected: boolean; revocationStatus: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in is required.");
    const bundle = await ctx.runQuery(internal.accounts.disconnectBundle, { ...args, identitySubject: identity.tokenIdentifier });
    if (!bundle) throw new Error("Connected account not found or you do not have permission to disconnect it.");
    const revocationStatus = await revokePlatformCredential(bundle.account, bundle.credential);
    await ctx.runMutation(internal.accounts.disconnect, { ...args, revocationStatus });
    return { disconnected: true, revocationStatus };
  },
});
