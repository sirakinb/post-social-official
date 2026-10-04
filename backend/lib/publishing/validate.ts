// What each platform accepts, checked before a post is submitted and again right before
// it is sent. Problems are plain sentences an AI or a person can act on. Pure functions.
import type { Platform } from "../connections/platforms";

export type InstagramOptions = { kind: "instagram"; media_type: "image" | "reel" | "carousel"; caption?: string };
export type FacebookOptions = { kind: "facebook"; media_type: "text" | "link" | "image" | "reel" | "video"; message?: string; link?: string; title?: string };
export type ThreadsOptions = { kind: "threads"; media_type: "text" | "image" | "video" | "carousel"; text?: string };
export type YouTubeOptions = { kind: "youtube"; title: string; description?: string; privacy_status: "public" | "unlisted" | "private" };
export type TikTokOptions = {
  kind: "tiktok";
  delivery_mode: "direct" | "inbox";
  privacy_level?: string;
  comments_enabled?: boolean;
  duet_enabled?: boolean;
  stitch_enabled?: boolean;
  disclose_your_brand?: boolean;
  disclose_branded_content?: boolean;
  ai_generated?: boolean;
};
export type DestinationOptions = InstagramOptions | FacebookOptions | ThreadsOptions | YouTubeOptions | TikTokOptions;

export type MediaFacts = {
  id: string;
  name: string;
  status: string;
  media_type: "image" | "video";
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
};

export type Capabilities = { video_max_seconds?: number };

export const POST_TYPES: Record<Platform, string[]> = {
  instagram: ["image", "reel", "carousel"],
  facebook: ["text", "link", "image", "reel", "video"],
  threads: ["text", "image", "video", "carousel"],
  youtube: ["short"],
  tiktok: ["direct", "inbox"],
};

const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];

function seconds(value: number) {
  const total = Math.round(value);
  if (total < 60) return `${total} seconds`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Fills defaults and drops unknown fields. Returns problems for anything unusable.
export function normalizeOptions(platform: Platform, raw: unknown): { options?: DestinationOptions; problems: string[] } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined);
  const bool = (key: string) => input[key] === true;
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback?: T) => {
    const value = str(key) ?? fallback;
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
  };

  switch (platform) {
    case "instagram": {
      const media_type = pick("media_type", ["image", "reel", "carousel"] as const);
      if (!media_type) return { problems: ["Choose an Instagram post type: image, reel or carousel."] };
      return { options: { kind: "instagram", media_type, caption: str("caption") }, problems: [] };
    }
    case "facebook": {
      const media_type = pick("media_type", ["text", "link", "image", "reel", "video"] as const);
      if (!media_type) return { problems: ["Choose a Facebook post type: text, link, image, reel or video."] };
      return { options: { kind: "facebook", media_type, message: str("message"), link: str("link"), title: str("title") }, problems: [] };
    }
    case "threads": {
      const media_type = pick("media_type", ["text", "image", "video", "carousel"] as const);
      if (!media_type) return { problems: ["Choose a Threads post type: text, image, video or carousel."] };
      return { options: { kind: "threads", media_type, text: str("text") }, problems: [] };
    }
    case "youtube": {
      const privacy_status = pick("privacy_status", ["public", "unlisted", "private"] as const);
      if (!privacy_status) return { problems: ["Choose who can see the YouTube Short: public, unlisted or private."] };
      return { options: { kind: "youtube", title: str("title") ?? "", description: str("description"), privacy_status }, problems: [] };
    }
    case "tiktok": {
      const delivery_mode = pick("delivery_mode", ["direct", "inbox"] as const, "direct")!;
      return {
        options: {
          kind: "tiktok",
          delivery_mode,
          privacy_level: str("privacy_level"),
          // Interactions are off unless the person turns them on (TikTok's guidelines).
          comments_enabled: bool("comments_enabled"),
          duet_enabled: bool("duet_enabled"),
          stitch_enabled: bool("stitch_enabled"),
          disclose_your_brand: bool("disclose_your_brand"),
          disclose_branded_content: bool("disclose_branded_content"),
          ai_generated: bool("ai_generated"),
        },
        problems: [],
      };
    }
  }
}

export function captionFor(options: DestinationOptions, postCaption: string) {
  if (options.kind === "instagram") return options.caption ?? postCaption;
  if (options.kind === "facebook") return options.message ?? postCaption;
  if (options.kind === "threads") return options.text ?? postCaption;
  if (options.kind === "youtube") return options.description ?? postCaption;
  return postCaption;
}

// All problems for one destination. Empty means it can be sent.
export function destinationProblems(args: {
  options: DestinationOptions;
  caption: string;
  media: MediaFacts[];
  capabilities?: Capabilities;
}): string[] {
  const { options, media, capabilities } = args;
  const caption = captionFor(options, args.caption).trim();
  const problems: string[] = [];
  const videos = media.filter((m) => m.media_type === "video");
  const images = media.filter((m) => m.media_type === "image");

  for (const item of media) {
    if (item.status !== "ready") problems.push(`${item.name} is ${item.status === "processing" ? "still being checked" : item.status}; only ready media can be posted.`);
  }
  const videoLength = (item: MediaFacts, min: number | null, max: number, label: string) => {
    if (item.duration_seconds === null) return;
    if (min !== null && item.duration_seconds < min) problems.push(`${label} must be at least ${seconds(min)}; ${item.name} is ${seconds(item.duration_seconds)}.`);
    if (item.duration_seconds > max) problems.push(`${label} can be at most ${seconds(max)}; ${item.name} is ${seconds(item.duration_seconds)}.`);
  };
  const types = (items: MediaFacts[], allowed: string[], label: string) => {
    for (const item of items) if (!allowed.includes(item.mime_type)) problems.push(`${label} must be ${allowed.map((t) => t.split("/")[1].toUpperCase().replace("QUICKTIME", "MOV")).join(" or ")}; ${item.name} is ${item.mime_type}.`);
  };
  const exactly = (count: number, kind: "image" | "video" | "file", label: string) => {
    const matching = kind === "file" ? media : kind === "image" ? images : videos;
    if (matching.length !== count || media.length !== count) problems.push(`${label} needs exactly ${plural(count, kind)}${media.length ? `; this post has ${plural(media.length, "file")}` : ""}.`);
  };

  // Instagram feed photos must be between 4:5 (portrait) and 1.91:1 (landscape).
  const instagramShape = (items: MediaFacts[]) => {
    for (const item of items) {
      if (!item.width || !item.height) continue;
      const ratio = item.width / item.height;
      if (ratio < 0.8 - 0.005 || ratio > 1.91 + 0.005) {
        problems.push(`Instagram photos must be between 4:5 (portrait) and 1.91:1 (landscape); ${item.name} is ${item.width}×${item.height}. Crop it to 4:5, e.g. 1080×1350.`);
      }
    }
  };

  switch (options.kind) {
    case "instagram":
      if (caption.length > 2200) problems.push(`Instagram captions can be at most 2,200 characters; this one is ${caption.length.toLocaleString("en-US")}.`);
      if (options.media_type === "image") {
        exactly(1, "image", "An Instagram image post");
        types(images, ["image/jpeg"], "Instagram images");
        instagramShape(images);
      } else if (options.media_type === "reel") {
        exactly(1, "video", "An Instagram Reel");
        types(videos, ["video/mp4", "video/quicktime"], "Instagram Reels");
        videos.forEach((v) => videoLength(v, 3, 900, "Instagram Reels"));
      } else {
        if (media.length < 2 || media.length > 10) problems.push(`An Instagram carousel needs 2 to 10 files; this post has ${plural(media.length, "file")}.`);
        types(images, ["image/jpeg"], "Instagram carousel images");
        instagramShape(images);
        types(videos, ["video/mp4", "video/quicktime"], "Instagram carousel videos");
        videos.forEach((v) => videoLength(v, 3, 60, "Videos in an Instagram carousel"));
      }
      break;

    case "facebook":
      if (options.media_type === "text") {
        if (!caption) problems.push("Write the text for this Facebook post.");
        if (media.length) problems.push("A Facebook text post cannot include media; choose image, reel or video instead.");
      } else if (options.media_type === "link") {
        if (!options.link || !/^https?:\/\/\S+$/.test(options.link)) problems.push("Add the link to share in this Facebook post (starting with https://).");
        if (media.length) problems.push("A Facebook link post cannot include media; Facebook builds the preview from the link.");
      } else if (options.media_type === "image") {
        exactly(1, "image", "A Facebook image post");
      } else if (options.media_type === "reel") {
        exactly(1, "video", "A Facebook Reel");
        types(videos, ["video/mp4"], "Facebook Reels");
        videos.forEach((v) => {
          videoLength(v, 3, 90, "Facebook Reels");
          if (v.width && v.height && Math.abs(v.width / v.height - 9 / 16) > 0.02) {
            problems.push(`Facebook Reels must be vertical 9:16; ${v.name} is ${v.width}×${v.height}.`);
          }
        });
      } else {
        exactly(1, "video", "A Facebook video post");
        types(videos, ["video/mp4", "video/quicktime"], "Facebook videos");
      }
      break;

    case "threads":
      if (caption.length > 500) problems.push(`Threads posts can be at most 500 characters; this one is ${caption.length}.`);
      if (options.media_type === "text") {
        if (!caption) problems.push("Write the text for this Threads post.");
        if (media.length) problems.push("A Threads text post cannot include media; choose image, video or carousel instead.");
      } else if (options.media_type === "image") {
        exactly(1, "image", "A Threads image post");
        types(images, ["image/jpeg", "image/png"], "Threads images");
      } else if (options.media_type === "video") {
        exactly(1, "video", "A Threads video post");
        types(videos, ["video/mp4", "video/quicktime"], "Threads videos");
        videos.forEach((v) => videoLength(v, null, 300, "Threads videos"));
      } else {
        if (media.length < 2 || media.length > 20) problems.push(`A Threads carousel needs 2 to 20 files; this post has ${plural(media.length, "file")}.`);
        types(images, ["image/jpeg", "image/png"], "Threads carousel images");
        types(videos, ["video/mp4", "video/quicktime"], "Threads carousel videos");
        videos.forEach((v) => videoLength(v, null, 300, "Threads videos"));
      }
      break;

    case "youtube": {
      const title = options.title.trim();
      if (!title) problems.push("Add a title for the YouTube Short.");
      if (title.length > 100) problems.push(`YouTube titles can be at most 100 characters; this one is ${title.length}.`);
      if ((options.description ?? "").length > 5000) problems.push("YouTube descriptions can be at most 5,000 characters.");
      exactly(1, "video", "A YouTube Short");
      videos.forEach((v) => {
        videoLength(v, null, 180, "YouTube Shorts");
        if (v.width && v.height && v.width > v.height) problems.push(`YouTube Shorts must be vertical or square; ${v.name} is ${v.width}×${v.height}.`);
      });
      break;
    }

    case "tiktok": {
      const max = capabilities?.video_max_seconds ?? 600;
      if (images.length) problems.push("TikTok photo posts are not available yet; post a video, or send it as a draft.");
      exactly(1, "video", options.delivery_mode === "inbox" ? "A TikTok draft" : "A TikTok post");
      types(videos, ["video/mp4", "video/quicktime", "video/webm"], "TikTok videos");
      videos.forEach((v) => videoLength(v, 3, max, "Videos on this TikTok account"));
      if (options.delivery_mode === "direct") {
        if (caption.length > 2200) problems.push(`TikTok captions can be at most 2,200 characters; this one is ${caption.length.toLocaleString("en-US")}.`);
        // TikTok requires the person to choose; there is no default.
        if (!options.privacy_level || !TIKTOK_PRIVACY.includes(options.privacy_level)) {
          problems.push("Choose who can see this TikTok: everyone, friends, followers or only you.");
        }
        if (options.disclose_branded_content && options.privacy_level === "SELF_ONLY") {
          problems.push("Branded content on TikTok cannot be private; choose a wider audience or turn off branded content.");
        }
      }
      break;
    }
  }
  return problems;
}
