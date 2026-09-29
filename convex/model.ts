import { v } from "convex/values";

export const platform = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("facebook"),
  v.literal("threads"),
  v.literal("youtube")
);

export const entryPoint = v.union(
  v.literal("ui"),
  v.literal("api"),
  v.literal("mcp")
);

export const approvalPolicy = v.union(
  v.literal("confirm_each"),
  v.literal("approve_after_draft"),
  v.literal("autonomous")
);

export const postStatus = v.union(
  v.literal("draft"),
  v.literal("awaiting_approval"),
  v.literal("approved"),
  v.literal("scheduled"),
  v.literal("processing"),
  v.literal("published"),
  v.literal("partially_published"),
  v.literal("failed"),
  v.literal("cancelled")
);

export const destinationStatus = v.union(
  v.literal("draft"),
  v.literal("awaiting_approval"),
  v.literal("approved"),
  v.literal("scheduled"),
  v.literal("queued"),
  v.literal("uploading"),
  v.literal("processing"),
  v.literal("published"),
  v.literal("failed"),
  v.literal("cancelled")
);

export const connectedAccountHealth = v.union(
  v.literal("connected"),
  v.literal("needs_attention"),
  v.literal("disconnected")
);

export const tiktokOptions = v.object({
  kind: v.literal("tiktok"),
  privacyLevel: v.string(),
  commentEnabled: v.boolean(),
  duetEnabled: v.boolean(),
  stitchEnabled: v.boolean(),
  disclosureEnabled: v.boolean(),
  yourBrandEnabled: v.boolean(),
  brandedContentEnabled: v.boolean(),
  aiGenerated: v.optional(v.boolean()),
  // "inbox" uploads the video as a draft to the creator's TikTok inbox (video.upload)
  // instead of Direct Post. TikTok ignores privacy, interaction and caption settings for drafts.
  deliveryMode: v.optional(v.union(v.literal("direct"), v.literal("inbox"))),
  creatorInfoCheckedAt: v.number(),
  creatorInfoSnapshot: v.object({
    nickname: v.string(),
    maxVideoDurationSec: v.number(),
    canPost: v.boolean(),
    privacyLevelOptions: v.array(v.string()),
    commentAvailable: v.optional(v.boolean()),
    duetAvailable: v.optional(v.boolean()),
    stitchAvailable: v.optional(v.boolean()),
  }),
});

export const instagramOptions = v.object({
  kind: v.literal("instagram"),
  mediaType: v.union(v.literal("image"), v.literal("reel"), v.literal("carousel")),
  caption: v.optional(v.string()),
});

export const facebookOptions = v.object({
  kind: v.literal("facebook"),
  mediaType: v.union(v.literal("image"), v.literal("video"), v.literal("feed")),
  message: v.optional(v.string()),
});

export const threadsOptions = v.object({
  kind: v.literal("threads"),
  mediaType: v.union(v.literal("text"), v.literal("image")),
  text: v.string(),
});

export const youtubeOptions = v.object({
  kind: v.literal("youtube"),
  title: v.string(),
  description: v.optional(v.string()),
  privacyStatus: v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
});

export const destinationOptions = v.union(
  tiktokOptions,
  instagramOptions,
  facebookOptions,
  threadsOptions,
  youtubeOptions
);
