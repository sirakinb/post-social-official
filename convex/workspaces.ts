import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { approvalPolicy } from "./model";
import { requireCurrentUser, requireWorkspaceMember } from "./lib/access";

export const create = mutation({
  args: { name: v.string(), slug: v.string(), defaultApprovalPolicy: approvalPolicy },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in is required.");
    const normalizedName = args.name.trim();
    const normalizedSlug = args.slug.trim().toLowerCase();
    if (normalizedName.length < 2) throw new Error("Workspace name is too short.");
    if (!/^[a-z0-9-]{2,50}$/.test(normalizedSlug)) throw new Error("Use letters, numbers, and hyphens for the workspace address.");
    const duplicate = await ctx.db.query("workspaces").withIndex("by_slug", (q) => q.eq("slug", normalizedSlug)).unique();
    if (duplicate) throw new Error("That workspace address is already in use.");
    const now = Date.now();
    let user = await ctx.db.query("users").withIndex("by_identity_subject", (q) => q.eq("identitySubject", identity.tokenIdentifier)).unique();
    if (!user) {
      const userId = await ctx.db.insert("users", {
        identitySubject: identity.tokenIdentifier,
        email: identity.email,
        name: identity.name,
        lastSeenAt: now,
      });
      user = await ctx.db.get(userId);
    }
    if (!user) throw new Error("Could not create your profile.");
    const workspaceId = await ctx.db.insert("workspaces", {
      name: normalizedName,
      slug: normalizedSlug,
      defaultApprovalPolicy: args.defaultApprovalPolicy,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", { workspaceId, userId: user._id, role: "owner", createdAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: user._id,
      entryPoint: "ui",
      eventType: "workspace.created",
      entityType: "workspace",
      entityId: workspaceId,
      summary: "Workspace created",
      occurredAt: now,
    });
    return workspaceId;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const memberships = await ctx.db.query("workspaceMembers").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return (await Promise.all(memberships.map(async (membership) => {
      const workspace = await ctx.db.get(membership.workspaceId);
      return workspace ? { ...workspace, role: membership.role } : null;
    }))).filter((workspace) => workspace !== null);
  },
});

export const get = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    return await ctx.db.get(workspaceId);
  },
});

export const updateApprovalPolicy = mutation({
  args: { workspaceId: v.id("workspaces"), policy: approvalPolicy },
  handler: async (ctx, { workspaceId, policy }) => {
    const { user, membership } = await requireWorkspaceMember(ctx, workspaceId);
    if (membership.role !== "owner" && membership.role !== "admin") {
      throw new Error("Workspace owner or admin permission is required to change approval settings.");
    }
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    const now = Date.now();
    await ctx.db.patch(workspaceId, { defaultApprovalPolicy: policy, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: user._id,
      entryPoint: "ui",
      eventType: "workspace.approval_policy_changed",
      entityType: "workspace",
      entityId: workspaceId,
      summary: "Workspace approval policy changed",
      safeMetadata: { priorPolicy: workspace.defaultApprovalPolicy, policy },
      occurredAt: now,
    });
    return { policy };
  },
});

export const deletionBundle = internalQuery({
  args: { workspaceId: v.id("workspaces"), identitySubject: v.string() },
  handler: async (ctx, { workspaceId, identitySubject }) => {
    const user = await ctx.db.query("users").withIndex("by_identity_subject", (q) => q.eq("identitySubject", identitySubject)).unique();
    if (!user) return null;
    const membership = await ctx.db.query("workspaceMembers").withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", user._id)).unique();
    if (!membership || membership.role !== "owner") return null;
    const accounts = await ctx.db.query("connectedAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    return await Promise.all(accounts.map(async (account) => ({ account, credential: await ctx.db.get(account.credentialId) })));
  },
});

export const deleteOwned = internalMutation({
  args: { workspaceId: v.id("workspaces"), confirmationName: v.string() },
  handler: async (ctx, { workspaceId, confirmationName }) => {
    const { membership } = await requireWorkspaceMember(ctx, workspaceId);
    if (membership.role !== "owner") throw new Error("Only the workspace owner can delete this workspace.");
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    if (confirmationName.trim() !== workspace.name) throw new Error(`Type “${workspace.name}” exactly to confirm deletion.`);

    const posts = await ctx.db.query("posts").withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const post of posts) {
      const destinations = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", post._id)).collect();
      for (const destination of destinations) {
        const jobs = await ctx.db.query("publishJobs").withIndex("by_destination", (q) => q.eq("destinationId", destination._id)).collect();
        for (const job of jobs) await ctx.db.delete(job._id);
        await ctx.db.delete(destination._id);
      }
      const approvals = await ctx.db.query("approvals").withIndex("by_post", (q) => q.eq("postId", post._id)).collect();
      for (const approval of approvals) await ctx.db.delete(approval._id);
      const approvalRequests = await ctx.db.query("approvalRequests").withIndex("by_post", (q) => q.eq("postId", post._id)).collect();
      for (const request of approvalRequests) await ctx.db.delete(request._id);
      await ctx.db.delete(post._id);
    }

    const media = await ctx.db.query("mediaAssets").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const asset of media) {
      await ctx.storage.delete(asset.storageId);
      await ctx.db.delete(asset._id);
    }
    const accounts = await ctx.db.query("connectedAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const account of accounts) {
      const credential = await ctx.db.get(account.credentialId);
      if (credential) await ctx.db.delete(credential._id);
      await ctx.db.delete(account._id);
    }
    const oauthStates = await ctx.db.query("oauthStates").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const state of oauthStates) await ctx.db.delete(state._id);
    const rateLimits = await ctx.db.query("platformRateLimits").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const rateLimit of rateLimits) await ctx.db.delete(rateLimit._id);
    const apiKeys = await ctx.db.query("apiKeys").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const apiKey of apiKeys) await ctx.db.delete(apiKey._id);
    const webhooks = await ctx.db.query("webhookEndpoints").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const webhook of webhooks) {
      const deliveries = await ctx.db.query("webhookDeliveries").withIndex("by_endpoint", (q) => q.eq("endpointId", webhook._id)).collect();
      for (const delivery of deliveries) await ctx.db.delete(delivery._id);
      await ctx.db.delete(webhook._id);
    }
    const events = await ctx.db.query("auditEvents").withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const event of events) await ctx.db.delete(event._id);
    const members = await ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const member of members) await ctx.db.delete(member._id);
    await ctx.db.delete(workspaceId);

    return { deleted: true };
  },
});
