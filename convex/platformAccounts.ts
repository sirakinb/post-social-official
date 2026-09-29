"use node";

import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

type TikTokPayload = { data?: { creator_nickname?: string; creator_avatar_url?: string; privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean; max_video_post_duration_sec?: number }; error?: { code?: string; message?: string } };
type CreatorInfoResult = { creatorId: string; nickname: string; avatarUrl?: string; privacyLevelOptions: { value: string; label: string }[]; commentAvailable: boolean; duetAvailable: boolean; stitchAvailable: boolean; maxVideoDurationSec: number; canPost: boolean; checkedAt: number; reason?: string };

async function fetchTikTokCreatorInfo(ctx: ActionCtx, args: { workspaceId: Id<"workspaces">; accountId: Id<"connectedAccounts"> }): Promise<CreatorInfoResult> {
    const account: Doc<"connectedAccounts"> | null = await ctx.runQuery(internal.publishingData.getAccount, args);
    if (!account || account.platform !== "tiktok") throw new Error("TikTok account not found.");
    const reserved = await ctx.runMutation(internal.rateLimits.reserve, { workspaceId: args.workspaceId, connectedAccountId: account._id, platform: "tiktok", operation: "creator_info", limit: 20, windowMs: 60_000 });
    if (!reserved.allowed) throw new Error("TikTok account options were checked too often. Please try again in a minute.");
    const token: { accessToken: string; refreshToken?: string } = await ctx.runAction(internal.credentialVault.decrypt, { credentialId: account.credentialId });
    const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json; charset=UTF-8" } });
    const payload = await response.json() as TikTokPayload;
    const canPost = response.ok && payload.error?.code === "ok";
    const errorCode = payload.error?.code;
    if (!canPost && errorCode && ["access_token_invalid", "scope_not_authorized"].includes(errorCode)) throw new Error("TikTok needs to be reconnected.");
    return { creatorId: account.externalAccountId, nickname: payload.data?.creator_nickname ?? account.displayName, avatarUrl: payload.data?.creator_avatar_url ?? account.avatarUrl, privacyLevelOptions: (payload.data?.privacy_level_options ?? []).map((value: string) => ({ value, label: value === "SELF_ONLY" ? "Only you" : value === "PUBLIC_TO_EVERYONE" ? "Public" : value === "FOLLOWER_OF_CREATOR" ? "Followers" : value === "MUTUAL_FOLLOW_FRIENDS" ? "Friends" : value.toLowerCase().replaceAll("_", " ") })), commentAvailable: !payload.data?.comment_disabled, duetAvailable: !payload.data?.duet_disabled, stitchAvailable: !payload.data?.stitch_disabled, maxVideoDurationSec: payload.data?.max_video_post_duration_sec ?? 60, canPost, checkedAt: Date.now(), reason: canPost ? undefined : payload.error?.message ?? "TikTok cannot post right now." };
}

export const getTikTokCreatorInfo = action({
  args: { workspaceId: v.id("workspaces"), accountId: v.id("connectedAccounts") },
  handler: async (ctx, args): Promise<CreatorInfoResult> => {
    await ctx.runQuery(api.workspaces.get, { workspaceId: args.workspaceId });
    return await fetchTikTokCreatorInfo(ctx, args);
  },
});

export const getTikTokCreatorInfoInternal = internalAction({
  args: { workspaceId: v.id("workspaces"), accountId: v.id("connectedAccounts") },
  handler: async (ctx, args): Promise<CreatorInfoResult> => await fetchTikTokCreatorInfo(ctx, args),
});
