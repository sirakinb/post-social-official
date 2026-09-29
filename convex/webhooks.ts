import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireWorkspaceMember } from "./lib/access";

const webhookEvent = v.union(v.literal("destination.published"), v.literal("destination.failed"));
const RETRY_DELAYS = [30_000, 5 * 60_000, 30 * 60_000];

export const store = internalMutation({
  args: {
    workspaceId: v.id("workspaces"), identitySubject: v.string(), url: v.string(), description: v.string(), events: v.array(webhookEvent), secretHash: v.string(), secretEncryptedPayload: v.string(), secretInitializationVector: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_identity_subject", (q) => q.eq("identitySubject", args.identitySubject)).unique();
    if (!user) throw new Error("Post Social profile not found.");
    const membership = await ctx.db.query("workspaceMembers").withIndex("by_workspace_user", (q) => q.eq("workspaceId", args.workspaceId).eq("userId", user._id)).unique();
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) throw new Error("Owner or admin permission is required to create a webhook.");
    const existingEndpoints = await ctx.db.query("webhookEndpoints").withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId)).collect();
    if (existingEndpoints.filter((endpoint) => endpoint.active).length >= 10) throw new Error("A workspace can have at most 10 active webhook endpoints.");
    const now = Date.now();
    const endpointId = await ctx.db.insert("webhookEndpoints", { workspaceId: args.workspaceId, createdBy: user._id, url: args.url, description: args.description, events: args.events, secretHash: args.secretHash, secretEncryptedPayload: args.secretEncryptedPayload, secretInitializationVector: args.secretInitializationVector, active: true, createdAt: now, updatedAt: now });
    await ctx.db.insert("auditEvents", { workspaceId: args.workspaceId, actorUserId: user._id, entryPoint: "api", eventType: "webhook.created", entityType: "workspace", entityId: args.workspaceId, summary: "Developer webhook created", safeMetadata: { events: args.events.join(",") }, occurredAt: now });
    return endpointId;
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const endpoints = await ctx.db.query("webhookEndpoints").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order("desc").collect();
    return endpoints.map(({ secretHash, secretEncryptedPayload: _secretEncryptedPayload, secretInitializationVector: _secretInitializationVector, ...safe }) => ({ ...safe, secretFingerprint: secretHash.slice(0, 8) }));
  },
});

export const remove = mutation({
  args: { workspaceId: v.id("workspaces"), endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { workspaceId, endpointId }) => {
    const { user, membership } = await requireWorkspaceMember(ctx, workspaceId);
    if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Owner or admin permission is required to remove a webhook.");
    const endpoint = await ctx.db.get(endpointId);
    if (!endpoint || endpoint.workspaceId !== workspaceId) throw new Error("Webhook not found.");
    const deliveries = await ctx.db.query("webhookDeliveries").withIndex("by_endpoint", (q) => q.eq("endpointId", endpointId)).collect();
    for (const delivery of deliveries) await ctx.db.delete(delivery._id);
    await ctx.db.delete(endpointId);
    await ctx.db.insert("auditEvents", { workspaceId, actorUserId: user._id, entryPoint: "api", eventType: "webhook.removed", entityType: "workspace", entityId: workspaceId, summary: "Developer webhook removed", occurredAt: Date.now() });
    return { removed: true };
  },
});

export const enqueue = internalMutation({
  args: { workspaceId: v.id("workspaces"), event: webhookEvent, payloadJson: v.string() },
  handler: async (ctx, args) => {
    const endpoints = await ctx.db.query("webhookEndpoints").withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId)).collect();
    const now = Date.now();
    for (const endpoint of endpoints) {
      if (!endpoint.active || !endpoint.events.includes(args.event)) continue;
      const deliveryId = await ctx.db.insert("webhookDeliveries", { workspaceId: args.workspaceId, endpointId: endpoint._id, event: args.event, payloadJson: args.payloadJson, state: "queued", attemptCount: 0, nextAttemptAt: now, createdAt: now, updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.webhookActions.deliver, { deliveryId });
    }
  },
});

export const deliveryBundle = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || !["queued", "retry_wait"].includes(delivery.state)) return null;
    const endpoint = await ctx.db.get(delivery.endpointId);
    return endpoint?.active ? { delivery, endpoint } : null;
  },
});

export const recordDelivery = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), delivered: v.boolean(), statusCode: v.optional(v.number()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return null;
    const now = Date.now();
    const attemptCount = delivery.attemptCount + 1;
    if (args.delivered) {
      await ctx.db.patch(delivery._id, { state: "delivered", attemptCount, lastStatusCode: args.statusCode, lastError: undefined, updatedAt: now });
      await ctx.db.patch(delivery.endpointId, { lastDeliveredAt: now, lastStatusCode: args.statusCode, updatedAt: now });
      return null;
    }
    const delay = RETRY_DELAYS[attemptCount - 1];
    if (delay) {
      const nextAttemptAt = now + delay;
      await ctx.db.patch(delivery._id, { state: "retry_wait", attemptCount, nextAttemptAt, lastStatusCode: args.statusCode, lastError: args.error?.slice(0, 300), updatedAt: now });
      return nextAttemptAt;
    }
    await ctx.db.patch(delivery._id, { state: "failed", attemptCount, lastStatusCode: args.statusCode, lastError: args.error?.slice(0, 300), updatedAt: now });
    await ctx.db.patch(delivery.endpointId, { lastStatusCode: args.statusCode, updatedAt: now });
    return null;
  },
});
