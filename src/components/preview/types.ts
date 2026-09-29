export type MockupPlatform = "tiktok" | "instagram" | "facebook" | "threads" | "youtube";

export type MockupMedia = {
  fileName: string;
  mediaType: "image" | "video";
  url?: string | null;
  width?: number;
  height?: number;
};

export type MockupAccount = { name: string; handle?: string; avatarUrl?: string };

/** What every platform mockup receives. Add a component per platform and register it in platform-preview.tsx. */
export type MockupProps = {
  media?: MockupMedia;
  caption: string;
  account: MockupAccount;
  showSafeZones: boolean;
};
