import { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { DataModel, Id } from "../_generated/dataModel";

type ReadCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

export async function requireCurrentUser(ctx: ReadCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in is required.");
  const user = await ctx.db
    .query("users")
    .withIndex("by_identity_subject", (q) => q.eq("identitySubject", identity.tokenIdentifier))
    .unique();
  if (!user) throw new Error("Your Post Social profile has not been created yet.");
  return user;
}

export async function requireWorkspaceMember(ctx: ReadCtx, workspaceId: Id<"workspaces">) {
  const user = await requireCurrentUser(ctx);
  const membership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", user._id))
    .unique();
  if (!membership) throw new Error("You do not have access to this workspace.");
  return { user, membership };
}

export async function requireWorkspaceReviewer(ctx: ReadCtx, workspaceId: Id<"workspaces">) {
  const access = await requireWorkspaceMember(ctx, workspaceId);
  if (!(["owner", "admin", "reviewer"] as const).includes(access.membership.role as "owner" | "admin" | "reviewer")) {
    throw new Error("Reviewer permission is required.");
  }
  return access;
}

