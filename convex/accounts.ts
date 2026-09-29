import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireWorkspaceMember } from "./lib/access";
import { deduplicateConnectedAccounts } from "./lib/accountDeduplication";
import { approvalPolicy } from "./model";

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const accounts = await ctx.db.query("connectedAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    return deduplicateConnectedAccounts(accounts).map(({ credentialId: _credentialId, ...safeAccount }) => safeAccount);
  },
});

export const disconnect = internalMutation({
  args: { workspaceId: v.id("workspaces"), accountId: v.id("connectedAccounts"), revocationStatus: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, accountId, revocationStatus }) => {
    const { user, membership } = await requireWorkspaceMember(ctx, workspaceId);
    if (membership.role !== "owner" && membership.role !== "admin") {
      throw new Error("Workspace owner or admin permission is required to disconnect an account.");
    }
    const account = await ctx.db.get(accountId);
    if (!account || account.workspaceId !== workspaceId) throw new Error("Connected account not found.");
    if (account.health === "disconnected") return { disconnected: true };

    const now = Date.now();
    const destinations = await ctx.db
      .query("destinations")
      .withIndex("by_account", (q) => q.eq("connectedAccountId", accountId))
      .collect();
    for (const destination of destinations) {
      if (!["published", "cancelled", "failed"].includes(destination.status)) {
        await ctx.db.patch(destination._id, { status: "cancelled", updatedAt: now });
      }
      const jobs = await ctx.db
        .query("publishJobs")
        .withIndex("by_destination", (q) => q.eq("destinationId", destination._id))
        .collect();
      for (const job of jobs) {
        if (!["complete", "failed", "cancelled"].includes(job.state)) {
          await ctx.db.patch(job._id, { state: "cancelled", updatedAt: now });
        }
      }
    }

    const credential = await ctx.db.get(account.credentialId);
    if (credential) await ctx.db.delete(account.credentialId);
    await ctx.db.patch(accountId, {
      health: "disconnected",
      healthReason: "Disconnected by workspace member",
      disconnectedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: user._id,
      entryPoint: "ui",
      eventType: "account.disconnected",
      entityType: "account",
      entityId: accountId,
      summary: `${account.platform} account disconnected`,
      safeMetadata: { platform: account.platform, revocationStatus: revocationStatus ?? "not_requested" },
      occurredAt: now,
    });
    return { disconnected: true };
  },
});

export const disconnectBundle = internalQuery({
  args: { workspaceId: v.id("workspaces"), accountId: v.id("connectedAccounts"), identitySubject: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_identity_subject", (q) => q.eq("identitySubject", args.identitySubject)).unique();
    if (!user) return null;
    const membership = await ctx.db.query("workspaceMembers").withIndex("by_workspace_user", (q) => q.eq("workspaceId", args.workspaceId).eq("userId", user._id)).unique();
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) return null;
    const account = await ctx.db.get(args.accountId);
    if (!account || account.workspaceId !== args.workspaceId) return null;
    const credential = await ctx.db.get(account.credentialId);
    return credential ? { account, credential } : { account, credential: null };
  },
});

export const updateApprovalPolicy = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    accountId: v.id("connectedAccounts"),
    policy: v.union(approvalPolicy, v.null()),
  },
  handler: async (ctx, { workspaceId, accountId, policy }) => {
    const { user, membership } = await requireWorkspaceMember(ctx, workspaceId);
    if (membership.role !== "owner" && membership.role !== "admin") {
      throw new Error("Workspace owner or admin permission is required to change approval settings.");
    }
    const account = await ctx.db.get(accountId);
    if (!account || account.workspaceId !== workspaceId) throw new Error("Connected account not found.");
    const now = Date.now();
    await ctx.db.patch(accountId, { approvalPolicyOverride: policy ?? undefined, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: user._id,
      entryPoint: "ui",
      eventType: "account.approval_policy_changed",
      entityType: "account",
      entityId: accountId,
      summary: `${account.platform} approval policy changed`,
      safeMetadata: {
        platform: account.platform,
        priorPolicy: account.approvalPolicyOverride ?? "workspace_default",
        policy: policy ?? "workspace_default",
      },
      occurredAt: now,
    });
    return { policy };
  },
});
