import {
  ConnectedAccount,
  Platform,
  Post,
  PostStatus,
  TikTokCreatorInfo,
} from "./types";

export const demoAccounts: ConnectedAccount[] = [
  {
    id: "acc_tiktok_1",
    platform: "tiktok",
    handle: "@akicreates",
    displayName: "Aki Creates",
    health: "connected",
  },
  {
    id: "acc_ig_1",
    platform: "instagram",
    handle: "akicreates",
    displayName: "Aki Creates",
    health: "needs_attention",
    healthReason: "Instagram needs a little attention",
  },
  {
    id: "acc_fb_1",
    platform: "facebook",
    handle: "Aki Creates",
    displayName: "Aki Creates Page",
    health: "connected",
  },
  {
    id: "acc_threads_1",
    platform: "threads",
    handle: "akicreates",
    displayName: "Aki Creates",
    health: "connected",
  },
];

export const demoPosts: Post[] = [
  {
    id: "post_1",
    caption: "Behind the scenes from this week’s shoot.",
    mediaType: "video",
    status: "scheduled",
    scheduledAt: "2026-07-22T09:00:00Z",
    results: [
      {
        accountId: "acc_tiktok_1",
        platform: "tiktok",
        status: "scheduled",
        statusText: "Scheduled for tomorrow at 9:00 AM",
      },
      {
        accountId: "acc_ig_1",
        platform: "instagram",
        status: "scheduled",
        statusText: "Scheduled for tomorrow at 9:00 AM",
      },
    ],
  },
  {
    id: "post_2",
    caption: "A calm moment from the studio floor.",
    mediaType: "image",
    status: "published",
    publishedAt: "2026-07-19T14:30:00Z",
    results: [
      {
        accountId: "acc_tiktok_1",
        platform: "tiktok",
        status: "published",
        statusText: "Published",
        liveUrl: "#demo-tiktok",
      },
      {
        accountId: "acc_ig_1",
        platform: "instagram",
        status: "published",
        statusText: "Published",
        liveUrl: "#demo-instagram",
      },
    ],
  },
  {
    id: "post_3",
    caption: "Quick tips for the week ahead.",
    mediaType: "video",
    status: "failed",
    results: [
      {
        accountId: "acc_fb_1",
        platform: "facebook",
        status: "failed",
        statusText: "Failed to publish",
        errorDetail:
          "Facebook returned a permissions error. Reconnect the page to try again.",
      },
    ],
  },
];

export const demoTikTokCreator: TikTokCreatorInfo = {
  creatorId: "demo_creator_1",
  nickname: "Aki Creates",
  privacyLevelOptions: [
    { value: "PUBLIC_TO_EVERYONE", label: "Public" },
    { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
    { value: "SELF_ONLY", label: "Only you" },
  ],
  commentAvailable: true,
  duetAvailable: false,
  stitchAvailable: true,
  maxVideoDurationSec: 600,
  canPost: true,
};

export function platformLabel(platform: Platform): string {
  switch (platform) {
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook Page";
    case "threads":
      return "Threads";
    case "youtube":
      return "YouTube";
  }
}

export function statusLabel(status: PostStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "scheduled":
      return "Scheduled";
    case "processing":
      return "Processing";
    case "published":
      return "Published";
    case "failed":
      return "Failed";
    case "partial":
      return "Partially published";
  }
}

export function formatScheduled(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
