import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { ApprovalPolicy, assertPostTransition, stateAfterApproval, stateAfterPublishRequest, strictestPolicy } from "./postState";
import { validateDestinationForPublish } from "./destinationValidation";

type MutationCtx = GenericMutationCtx<DataModel>;
type EntryPoint = "ui" | "api" | "mcp";
type DestinationInput = { connectedAccountId: Id<"connectedAccounts">; options: Doc<"destinations">["options"] };

export type CreateDraftServiceArgs = {
  workspaceId: Id<"workspaces">;
  userId: Id<"users">;
  caption: string;
  mediaAssetIds: Id<"mediaAssets">[];
  scheduledAt?: number;
  entryPoint: EntryPoint;
  destinations: DestinationInput[];
};

export async function createDraftCore(ctx: MutationCtx, args: CreateDraftServiceArgs) {
  if (args.caption.length > 10_000) throw new Error("The caption is too long.");
  if (args.destinations.length === 0) throw new Error("Choose at least one destination.");
  const uniqueAccounts = new Set(args.destinations.map((destination) => destination.connectedAccountId));
  if (uniqueAccounts.size !== args.destinations.length) throw new Error("Each account can only be selected once.");
  const workspace = await ctx.db.get(args.workspaceId);
  if (!workspace) throw new Error("Workspace not found.");
  const media = await Promise.all(args.mediaAssetIds.map((id) => ctx.db.get(id)));
  if (media.some((asset) => !asset || asset.workspaceId !== args.workspaceId)) throw new Error("One or more media files are unavailable.");
  const accountPairs = await Promise.all(args.destinations.map(async (destination) => ({ destination, account: await ctx.db.get(destination.connectedAccountId) })));
  for (const { destination, account } of accountPairs) {
    if (!account || account.workspaceId !== args.workspaceId) throw new Error("A selected account is unavailable.");
    if (account.health !== "connected") throw new Error(`${account.displayName} needs attention before it can publish.`);
    if (account.platform !== destination.options.kind) throw new Error("Destination settings do not match the selected platform.");
  }
  const policies = accountPairs.map(({ account }) => (account!.approvalPolicyOverride ?? workspace.defaultApprovalPolicy) as ApprovalPolicy);
  const effectiveApprovalPolicy = strictestPolicy(policies);
  const now = Date.now();
  const postId = await ctx.db.insert("posts", { workspaceId: args.workspaceId, createdBy: args.userId, entryPoint: args.entryPoint, caption: args.caption, mediaAssetIds: args.mediaAssetIds, status: "draft", scheduledAt: args.scheduledAt, effectiveApprovalPolicy, createdAt: now, updatedAt: now });
  for (const [index, pair] of accountPairs.entries()) {
    await ctx.db.insert("destinations", { workspaceId: args.workspaceId, postId, connectedAccountId: pair.destination.connectedAccountId, platform: pair.account!.platform, status: "draft", effectiveApprovalPolicy: policies[index], options: pair.destination.options, createdAt: now, updatedAt: now });
  }
  await ctx.db.insert("auditEvents", { workspaceId: args.workspaceId, actorUserId: args.userId, entryPoint: args.entryPoint, eventType: "post.draft_created", entityType: "post", entityId: postId, summary: args.entryPoint === "ui" ? "Post draft created" : "Post draft created by developer integration", safeMetadata: { destinationCount: args.destinations.length, mediaCount: args.mediaAssetIds.length }, occurredAt: now });
  return { postId, status: "draft" as const, effectiveApprovalPolicy };
}

export type RequestPublishServiceArgs = {
  workspaceId: Id<"workspaces">;
  userId: Id<"users">;
  postId: Id<"posts">;
  entryPoint: EntryPoint;
};

export async function requestPublishCore(ctx: MutationCtx, args: RequestPublishServiceArgs) {
  const post = await ctx.db.get(args.postId);
  if (!post || post.workspaceId !== args.workspaceId) throw new Error("Post not found.");
  if (post.status !== "draft") throw new Error("Only a draft can be submitted for publishing.");
  const destinations = await ctx.db.query("destinations").withIndex("by_post", (q) => q.eq("postId", post._id)).collect();
  if (destinations.length === 0) throw new Error("Choose at least one destination.");
  const workspace = await ctx.db.get(args.workspaceId);
  if (!workspace) throw new Error("Workspace not found.");
  const media = await Promise.all(post.mediaAssetIds.map((id) => ctx.db.get(id)));
  if (media.some((asset) => !asset)) throw new Error("One or more media files are unavailable.");
  const now = Date.now();
  const policies: ApprovalPolicy[] = [];
  for (const destination of destinations) {
    const account = await ctx.db.get(destination.connectedAccountId);
    if (!account || account.workspaceId !== args.workspaceId || account.health !== "connected") throw new Error("A destination needs attention before publishing.");
    const policy = (account.approvalPolicyOverride ?? workspace.defaultApprovalPolicy) as ApprovalPolicy;
    policies.push(policy);
    validateDestinationForPublish({
      options: destination.options,
      media: media.map((asset) => ({ mediaType: asset!.mediaType, mimeType: asset!.mimeType, durationSeconds: asset!.durationSeconds })),
      caption: post.caption,
      now,
    });
    await ctx.db.patch(destination._id, { effectiveApprovalPolicy: policy, consentedAt: now, updatedAt: now });
  }
  const effectivePolicy = strictestPolicy(policies);
  const requestedState = stateAfterPublishRequest(effectivePolicy);
  assertPostTransition("draft", requestedState);
  if (requestedState === "awaiting_approval") {
    await ctx.db.patch(post._id, { status: requestedState, entryPoint: args.entryPoint, effectiveApprovalPolicy: effectivePolicy, requestedAt: now, updatedAt: now });
    for (const destination of destinations) await ctx.db.patch(destination._id, { status: "awaiting_approval", updatedAt: now });
    await ctx.db.insert("approvalRequests", { workspaceId: args.workspaceId, postId: post._id, policy: effectivePolicy, status: "pending", requestedBy: args.userId, requestedAt: now });
  } else {
    const nextState = stateAfterApproval(post.scheduledAt, now);
    assertPostTransition("approved", nextState);
    await ctx.db.insert("approvals", {
      workspaceId: args.workspaceId,
      postId: post._id,
      policy: effectivePolicy,
      status: "approved",
      requestedBy: args.userId,
      decidedBy: args.userId,
      requestedAt: now,
      decidedAt: now,
      note: "Authorized by the workspace's autonomous publishing policy.",
    });
    await ctx.db.patch(post._id, { status: nextState, entryPoint: args.entryPoint, effectiveApprovalPolicy: effectivePolicy, requestedAt: now, approvedAt: now, updatedAt: now });
    for (const destination of destinations) {
      await ctx.db.patch(destination._id, { status: nextState === "scheduled" ? "scheduled" : "queued", updatedAt: now });
      const jobId = await ctx.db.insert("publishJobs", { workspaceId: args.workspaceId, postId: post._id, destinationId: destination._id, state: "queued", attemptCount: 0, nextAttemptAt: post.scheduledAt ?? now, createdAt: now, updatedAt: now });
      await ctx.scheduler.runAt(post.scheduledAt ?? now, internal.publishing.processJob, { jobId });
    }
  }
  await ctx.db.insert("auditEvents", { workspaceId: args.workspaceId, actorUserId: args.userId, entryPoint: args.entryPoint, eventType: requestedState === "awaiting_approval" ? "approval.requested" : "post.autonomous_publish_authorized", entityType: "post", entityId: post._id, summary: requestedState === "awaiting_approval" ? (args.entryPoint === "ui" ? "Human approval requested" : "Developer integration requested human approval") : "Approval policy authorized publishing", safeMetadata: { effectivePolicy, consentedAt: now }, occurredAt: now });
  return { postId: post._id, status: requestedState === "awaiting_approval" ? requestedState : stateAfterApproval(post.scheduledAt, now), effectiveApprovalPolicy: effectivePolicy };
}
