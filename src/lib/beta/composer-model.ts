// The composer's rules, kept free of React so they can be tested: per-platform defaults
// from the attached media, which caption each platform gets, character limits, and the
// TikTok requirements from its content sharing guidelines.

export type Platform = "instagram" | "facebook" | "threads" | "youtube" | "tiktok";
export type ComposerAccount = { id: string; platform: Platform; name: string; handle: string; avatarUrl: string | null; captionMax: number | null; videoMaxSeconds: number | null };
export type ComposerMedia = { id: string; name: string; type: "image" | "video"; width: number | null; height: number | null; duration: number | null; url: string | null; poster?: string | null };

// Per-account settings as the person chose them. `caption` overrides the shared caption.
export type PlatformChoice = {
  mediaType?: string; // instagram, facebook, threads
  caption?: string; // override (instagram.caption, facebook.message, threads.text, youtube.description)
  link?: string; // facebook link posts
  title?: string; // youtube (required), facebook video
  privacy?: "public" | "unlisted" | "private"; // youtube
  tiktok?: TikTokChoice;
};

export type TikTokChoice = {
  mode: "inbox" | "direct";
  privacyLevel: string; // "" until the person picks (no default, per TikTok)
  comments: boolean;
  duet: boolean;
  stitch: boolean;
  disclose: boolean;
  yourBrand: boolean;
  brandedContent: boolean;
  aiGenerated: boolean;
  title: string; // photo posts only (up to 90 characters)
};

export const NEW_TIKTOK: TikTokChoice = { mode: "inbox", privacyLevel: "", comments: false, duet: false, stitch: false, disclose: false, yourBrand: false, brandedContent: false, aiGenerated: false, title: "" };

// Only images make a TikTok photo post (a swipeable carousel of 1 to 35).
export const isTikTokPhotoPost = (media: ComposerMedia[]) => media.length > 0 && media.every((m) => m.type === "image");
export const TIKTOK_MAX_PHOTOS = 35;

export const MEDIA_TYPES: Partial<Record<Platform, Array<{ id: string; label: string }>>> = {
  instagram: [{ id: "image", label: "Image" }, { id: "reel", label: "Reel" }, { id: "carousel", label: "Carousel" }],
  facebook: [{ id: "text", label: "Text" }, { id: "link", label: "Link" }, { id: "image", label: "Image" }, { id: "reel", label: "Reel" }, { id: "video", label: "Video" }],
  threads: [{ id: "text", label: "Text" }, { id: "image", label: "Image" }, { id: "video", label: "Video" }, { id: "carousel", label: "Carousel" }],
};

// The post type that fits the attached media best; the person can change it.
export function defaultMediaType(platform: Platform, media: ComposerMedia[]): string | undefined {
  const videos = media.filter((m) => m.type === "video").length;
  const count = media.length;
  switch (platform) {
    case "instagram":
      return count > 1 ? "carousel" : videos ? "reel" : "image";
    case "facebook":
      return count === 0 ? "text" : videos ? "reel" : "image";
    case "threads":
      return count > 1 ? "carousel" : count === 0 ? "text" : videos ? "video" : "image";
    default:
      return undefined;
  }
}

export function effectiveCaption(shared: string, choice: PlatformChoice | undefined) {
  return choice?.caption ?? shared;
}

const URL_RE = /https?:\/\/\S+/;

// What a destination sends to the posts API for one account.
export function destinationOptions(account: ComposerAccount, choice: PlatformChoice, shared: string, media: ComposerMedia[]) {
  const mediaType = choice.mediaType ?? defaultMediaType(account.platform, media);
  switch (account.platform) {
    case "instagram":
      return { media_type: mediaType, ...(choice.caption !== undefined ? { caption: choice.caption } : {}) };
    case "facebook":
      return {
        media_type: mediaType,
        ...(choice.caption !== undefined ? { message: choice.caption } : {}),
        ...(mediaType === "link" ? { link: choice.link ?? effectiveCaption(shared, choice).match(URL_RE)?.[0] ?? "" } : {}),
        ...(choice.title ? { title: choice.title } : {}),
      };
    case "threads":
      return { media_type: mediaType, ...(choice.caption !== undefined ? { text: choice.caption } : {}) };
    case "youtube":
      return { title: choice.title ?? defaultTitle(shared), privacy_status: choice.privacy ?? "public", ...(choice.caption !== undefined ? { description: choice.caption } : {}) };
    case "tiktok": {
      const t = choice.tiktok ?? NEW_TIKTOK;
      const photo = isTikTokPhotoPost(media);
      const kind = { media_type: photo ? "photo" : "video", ...(photo && t.title?.trim() ? { title: t.title.trim() } : {}) };
      return t.mode === "inbox"
        ? { delivery_mode: "inbox", ...kind, ai_generated: t.aiGenerated }
        : {
            delivery_mode: "direct",
            ...kind,
            privacy_level: t.privacyLevel || undefined,
            comments_enabled: t.comments,
            duet_enabled: !photo && t.duet,
            stitch_enabled: !photo && t.stitch,
            disclose_your_brand: t.disclose && t.yourBrand,
            disclose_branded_content: t.disclose && t.brandedContent,
            ai_generated: t.aiGenerated,
          };
    }
  }
}

// YouTube needs a title: the caption's first line, up to 100 characters.
export function defaultTitle(caption: string) {
  const line = caption.split("\n").find((l) => l.trim()) ?? "";
  return line.trim().slice(0, 100);
}

export type Limit = { accountId: string; label: string; used: number; max: number; over: boolean };

export function captionLimits(accounts: ComposerAccount[], choices: Record<string, PlatformChoice>, shared: string): Limit[] {
  return accounts
    .filter((a) => a.captionMax)
    .map((a) => {
      const used = [...effectiveCaption(shared, choices[a.id])].length;
      return { accountId: a.id, label: SHORT[a.platform], used, max: a.captionMax!, over: used > a.captionMax! };
    });
}

export const SHORT: Record<Platform, string> = { instagram: "IG", facebook: "FB", threads: "Threads", youtube: "YT", tiktok: "TikTok" };
export const NAMES: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads", youtube: "YouTube", tiktok: "TikTok" };

export const TIKTOK_PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

// Problems TikTok's guidelines require us to catch before the Post button works.
export function tiktokProblems(t: TikTokChoice, info: { privacy_level_options: string[]; can_post: boolean; max_video_post_duration_sec: number | null } | null, media: ComposerMedia[]) {
  if (t.mode === "inbox") return [];
  const problems: string[] = [];
  if (!info) return ["Loading this TikTok account's settings…"];
  if (!info.can_post) problems.push("TikTok says this account can't post right now (often a daily limit). Try again later.");
  // (The audience choice itself is checked by the server, with the same wording AIs get.)
  if (t.disclose && !t.yourBrand && !t.brandedContent) problems.push("You turned on content disclosure: choose Your brand, Branded content, or both.");
  if (t.disclose && t.brandedContent && t.privacyLevel === "SELF_ONLY") problems.push("Branded content can't be private on TikTok. Choose a wider audience.");
  if (isTikTokPhotoPost(media)) {
    if (media.length > TIKTOK_MAX_PHOTOS) problems.push(`TikTok photo posts can have at most ${TIKTOK_MAX_PHOTOS} images; this one has ${media.length}.`);
    if ((t.title ?? "").length > 90) problems.push("TikTok photo titles can be at most 90 characters.");
    return problems;
  }
  const video = media.find((m) => m.type === "video");
  if (video?.duration && info.max_video_post_duration_sec && video.duration > info.max_video_post_duration_sec) {
    problems.push(`This TikTok account allows videos up to ${info.max_video_post_duration_sec} seconds; this one is ${Math.round(video.duration)}.`);
  }
  return problems;
}

// The label TikTok will show, which its guidelines require us to tell the person about.
export function tiktokLabel(t: TikTokChoice, photo = false) {
  if (t.mode !== "direct" || !t.disclose) return null;
  const what = photo ? "photo" : "video";
  if (t.brandedContent) return `Your ${what} will be labeled “Paid partnership”.`;
  if (t.yourBrand) return `Your ${what} will be labeled “Promotional content”.`;
  return null;
}
