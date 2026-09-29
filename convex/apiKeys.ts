import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireWorkspaceMember } from "./lib/access";

const DEFAULT_SCOPES = ["accounts:read", "media:write", "posts:read", "posts:write", "posts:publish"];

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 28) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const create = action({
  args: { workspaceId: v.id("workspaces"), name: v.string() },
  handler: async (ctx, { workspaceId, name }): Promise<{ id: string; key: string; prefix: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in is required.");
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 60) throw new Error("Give this key a name between 2 and 60 characters.");
    const key = `ps_live_${randomToken()}`;
    const prefix = key.slice(0, 15);
    const keyHash = await sha256(key);
    const id = await ctx.runMutation(internal.apiKeys.store, {
      workspaceId,
      identitySubject: identity.tokenIdentifier,
      name: normalizedName,
      keyPrefix: prefix,
      keyHash,
      scopes: DEFAULT_SCOPES,
    });
    return { id, key, prefix };
  },
});

export const store = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    identitySubject: v.string(),
    name: v.string(),
    keyPrefix: v.string(),
    keyHash: v.string(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_identity_subject", (q) => q.eq("identitySubject", args.identitySubject)).unique();
    if (!user) throw new Error("Post Social profile not found.");
    const membership = await ctx.db.query("workspaceMembers").withIndex("by_workspace_user", (q) => q.eq("workspaceId", args.workspaceId).eq("userId", user._id)).unique();
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) throw new Error("Owner or admin permission is required to create an API key.");
    const now = Date.now();
    const keyId = await ctx.db.insert("apiKeys", {
      workspaceId: args.workspaceId,
      createdBy: user._id,
      name: args.name,
      keyPrefix: args.keyPrefix,
      keyHash: args.keyHash,
      scopes: args.scopes,
      createdAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: user._id,
      entryPoint: "api",
      eventType: "api_key.created",
      entityType: "workspace",
      entityId: args.workspaceId,
      summary: "Developer API key created",
      safeMetadata: { keyPrefix: args.keyPrefix },
      occurredAt: now,
    });
    return keyId;
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const keys = await ctx.db.query("apiKeys").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order("desc").collect();
    return keys.map(({ keyHash: _keyHash, ...safe }) => safe);
  },
});

export const revoke = mutation({
  args: { workspaceId: v.id("workspaces"), keyId: v.id("apiKeys") },
  handler: async (ctx, { workspaceId, keyId }) => {
    const { user, membership } = await requireWorkspaceMember(ctx, workspaceId);
    if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Owner or admin permission is required to revoke an API key.");
    const key = await ctx.db.get(keyId);
    if (!key || key.workspaceId !== workspaceId) throw new Error("API key not found.");
    const now = Date.now();
    await ctx.db.patch(keyId, { revokedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: user._id,
      entryPoint: "api",
      eventType: "api_key.revoked",
      entityType: "workspace",
      entityId: workspaceId,
      summary: "Developer API key revoked",
      safeMetadata: { keyPrefix: key.keyPrefix },
      occurredAt: now,
    });
    return { revoked: true };
  },
});
