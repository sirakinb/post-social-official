"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { revokePlatformCredential } from "./lib/platformRevocation";

export const deleteOwned = action({
  args: { workspaceId: v.id("workspaces"), confirmationName: v.string() },
  handler: async (ctx, args): Promise<{ deleted: boolean; revocationSummary: Record<string, number> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in is required.");
    const bundle = await ctx.runQuery(internal.workspaces.deletionBundle, { workspaceId: args.workspaceId, identitySubject: identity.tokenIdentifier });
    if (!bundle) throw new Error("Only the workspace owner can delete this workspace.");
    const revocationSummary: Record<string, number> = {};
    for (const { account, credential } of bundle) {
      const status = await revokePlatformCredential(account, credential);
      revocationSummary[status] = (revocationSummary[status] ?? 0) + 1;
    }
    await ctx.runMutation(internal.workspaces.deleteOwned, args);
    return { deleted: true, revocationSummary };
  },
});
