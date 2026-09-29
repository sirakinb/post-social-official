import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  approvalPolicy,
  connectedAccountHealth,
  destinationOptions,
  destinationStatus,
  entryPoint,
  platform,
  postStatus,
} from "./model";

export default defineSchema({
  users: defineTable({
    identitySubject: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    lastSeenAt: v.number(),
  }).index("by_identity_subject", ["identitySubject"]),

  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    defaultApprovalPolicy: approvalPolicy,
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("reviewer")),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  oauthCredentials: defineTable({
    workspaceId: v.id("workspaces"),
    platform,
    encryptedPayload: v.string(),
    initializationVector: v.string(),
    algorithm: v.literal("AES-256-GCM"),
    keyVersion: v.number(),
    accessTokenExpiresAt: v.optional(v.number()),
    refreshTokenExpiresAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_workspace_platform", ["workspaceId", "platform"])
    .index("by_access_expiry", ["accessTokenExpiresAt"]),

  oauthStates: defineTable({
    workspaceId: v.id("workspaces"),
    identitySubject: v.string(),
    provider: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("facebook"),
      v.literal("threads"),
      v.literal("youtube")
    ),
    stateHash: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_state_hash", ["stateHash"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_workspace", ["workspaceId"]),

  platformRateLimits: defineTable({
    workspaceId: v.id("workspaces"),
    connectedAccountId: v.id("connectedAccounts"),
    platform,
    operation: v.string(),
    windowStart: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_operation_window", ["connectedAccountId", "operation", "windowStart"])
    .index("by_updated_at", ["updatedAt"])
    .index("by_workspace", ["workspaceId"]),

  apiKeys: defineTable({
    workspaceId: v.id("workspaces"),
    createdBy: v.id("users"),
    name: v.string(),
    keyPrefix: v.string(),
    keyHash: v.string(),
    scopes: v.array(v.string()),
    lastUsedAt: v.optional(v.number()),
    requestWindowStartedAt: v.optional(v.number()),
    requestCount: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_key_hash", ["keyHash"])
    .index("by_workspace", ["workspaceId"]),

  webhookEndpoints: defineTable({
    workspaceId: v.id("workspaces"),
    createdBy: v.id("users"),
    url: v.string(),
    description: v.string(),
    secretHash: v.string(),
    secretEncryptedPayload: v.string(),
    secretInitializationVector: v.string(),
    events: v.array(v.string()),
    active: v.boolean(),
    lastDeliveredAt: v.optional(v.number()),
    lastStatusCode: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  webhookDeliveries: defineTable({
    workspaceId: v.id("workspaces"),
    endpointId: v.id("webhookEndpoints"),
    event: v.string(),
    payloadJson: v.string(),
    state: v.union(v.literal("queued"), v.literal("delivered"), v.literal("retry_wait"), v.literal("failed")),
    attemptCount: v.number(),
    nextAttemptAt: v.number(),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_endpoint", ["endpointId"])
    .index("by_state_next", ["state", "nextAttemptAt"]),

  connectedAccounts: defineTable({
    workspaceId: v.id("workspaces"),
    platform,
    externalAccountId: v.string(),
    handle: v.string(),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    scopes: v.array(v.string()),
    credentialId: v.id("oauthCredentials"),
    health: connectedAccountHealth,
    healthReason: v.optional(v.string()),
    approvalPolicyOverride: v.optional(approvalPolicy),
    ownerExternalId: v.optional(v.string()),
    linkedFacebookPageId: v.optional(v.string()),
    lastVerifiedAt: v.optional(v.number()),
    disconnectedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_platform", ["workspaceId", "platform"])
    .index("by_platform_external", ["platform", "externalAccountId"])
    .index("by_owner_external", ["ownerExternalId"])
    .index("by_credential", ["credentialId"]),

  dataDeletionRequests: defineTable({
    provider: v.literal("meta"),
    confirmationCode: v.string(),
    externalUserHash: v.string(),
    status: v.union(v.literal("processing"), v.literal("completed"), v.literal("failed")),
    removedAccounts: v.number(),
    requestedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_confirmation_code", ["confirmationCode"])
    .index("by_requested_at", ["requestedAt"]),

  mediaAssets: defineTable({
    workspaceId: v.id("workspaces"),
    uploadedBy: v.id("users"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    mediaType: v.union(v.literal("video"), v.literal("image")),
    sizeBytes: v.number(),
    durationSeconds: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    checksumSha256: v.optional(v.string()),
    hiddenFromLibraryAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  posts: defineTable({
    workspaceId: v.id("workspaces"),
    createdBy: v.id("users"),
    entryPoint,
    caption: v.string(),
    mediaAssetIds: v.array(v.id("mediaAssets")),
    status: postStatus,
    scheduledAt: v.optional(v.number()),
    effectiveApprovalPolicy: approvalPolicy,
    requestedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_schedule", ["workspaceId", "scheduledAt"]),

  destinations: defineTable({
    workspaceId: v.id("workspaces"),
    postId: v.id("posts"),
    connectedAccountId: v.id("connectedAccounts"),
    platform,
    status: destinationStatus,
    effectiveApprovalPolicy: approvalPolicy,
    options: destinationOptions,
    consentedAt: v.optional(v.number()),
    platformRequestId: v.optional(v.string()),
    liveUrl: v.optional(v.string()),
    sanitizedErrorCode: v.optional(v.string()),
    sanitizedErrorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_post", ["postId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_account", ["connectedAccountId"]),

  approvals: defineTable({
    workspaceId: v.id("workspaces"),
    postId: v.id("posts"),
    policy: approvalPolicy,
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"), v.literal("cancelled")),
    requestedBy: v.id("users"),
    decidedBy: v.optional(v.id("users")),
    requestedAt: v.number(),
    decidedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  })
    .index("by_post", ["postId"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  approvalRequests: defineTable({
    workspaceId: v.id("workspaces"),
    postId: v.id("posts"),
    policy: approvalPolicy,
    status: v.union(v.literal("pending"), v.literal("decided"), v.literal("cancelled")),
    requestedBy: v.id("users"),
    requestedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  publishJobs: defineTable({
    workspaceId: v.id("workspaces"),
    postId: v.id("posts"),
    destinationId: v.id("destinations"),
    state: v.union(v.literal("queued"), v.literal("running"), v.literal("retry_wait"), v.literal("complete"), v.literal("failed"), v.literal("cancelled")),
    attemptCount: v.number(),
    nextAttemptAt: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_destination", ["destinationId"])
    .index("by_state_next_attempt", ["state", "nextAttemptAt"]),

  auditEvents: defineTable({
    workspaceId: v.id("workspaces"),
    actorUserId: v.optional(v.id("users")),
    entryPoint,
    eventType: v.string(),
    entityType: v.union(v.literal("workspace"), v.literal("account"), v.literal("post"), v.literal("destination"), v.literal("approval"), v.literal("publish_job")),
    entityId: v.string(),
    summary: v.string(),
    safeMetadata: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    occurredAt: v.number(),
  })
    .index("by_workspace_time", ["workspaceId", "occurredAt"])
    .index("by_entity", ["entityType", "entityId"]),
});
