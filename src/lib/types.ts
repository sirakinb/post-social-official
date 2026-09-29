export type Platform = "tiktok" | "instagram" | "facebook" | "threads" | "youtube";

export type PostStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "published"
  | "failed"
  | "partial";

export type AccountHealth = "connected" | "needs_attention" | "disconnected";

export interface ConnectedAccount {
  id: string;
  platform: Platform;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  health: AccountHealth;
  healthReason?: string;
}

export interface DestinationResult {
  accountId: string;
  platform: Platform;
  status: PostStatus;
  statusText: string;
  liveUrl?: string;
  errorDetail?: string;
}

export interface Post {
  id: string;
  caption: string;
  mediaType: "video" | "image" | "carousel";
  mediaUrl?: string;
  status: PostStatus;
  scheduledAt?: string;
  publishedAt?: string;
  results: DestinationResult[];
}

export interface TikTokCreatorInfo {
  creatorId: string;
  nickname: string;
  avatarUrl?: string;
  privacyLevelOptions: { value: string; label: string }[];
  commentAvailable: boolean;
  duetAvailable: boolean;
  stitchAvailable: boolean;
  maxVideoDurationSec: number;
  canPost: boolean;
}

export interface TikTokOptions {
  privacyLevel: string;
  commentEnabled: boolean;
  duetEnabled: boolean;
  stitchEnabled: boolean;
  disclosureEnabled: boolean;
  yourBrandEnabled: boolean;
  brandedContentEnabled: boolean;
  aiGenerated?: boolean;
  deliveryMode?: "direct" | "inbox";
}

export interface YouTubeOptions {
  title: string;
  description: string;
  privacyStatus: "public" | "unlisted" | "private";
}

export interface SelectedMedia {
  file: File;
  durationSeconds?: number;
}

export interface LibraryAsset {
  id: string;
  fileName: string;
  mimeType: string;
  mediaType: "video" | "image";
  sizeBytes: number;
  durationSeconds?: number;
  url?: string | null;
}
