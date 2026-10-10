// What each platform accepts, checked before a post is submitted and again right before
// it is sent. Problems are plain sentences an AI or a person can act on. Pure functions.
import type { Platform } from "../connections/platforms";
import { xWeightedLength } from "../connections/x";

export type InstagramOptions = { kind: "instagram"; media_type: "image" | "reel" | "carousel"; caption?: string };
export type FacebookOptions = { kind: "facebook"; media_type: "text" | "link" | "image" | "reel" | "video"; message?: string; link?: string; title?: string };
export type ThreadsOptions = { kind: "threads"; media_type: "text" | "image" | "video" | "carousel"; text?: string };
export type YouTubeOptions = { kind: "youtube"; title: string; description?: string; privacy_status: "public" | "unlisted" | "private" };
export type TikTokOptions = {
  kind: "tiktok";
  delivery_mode: "direct" | "inbox";
  // video, or photo (1 to 35 images, shown as a swipeable carousel). Left out, it follows
  // the media: images make a photo post.
  media_type?: "video" | "photo";
  // Photo posts only: an optional title above the caption.
  title?: string;
  privacy_level?: string;
  comments_enabled?: boolean;
  duet_enabled?: boolean;
  stitch_enabled?: boolean;
  disclose_your_brand?: boolean;
  disclose_branded_content?: boolean;
  ai_generated?: boolean;
};
// LinkedIn member posts. media_type left out follows the media: none is text, a video is
// a video post, images are an image post (2 to 20 show as a gallery).
export type LinkedInOptions = { kind: "linkedin"; media_type?: "text" | "image" | "video"; text?: string; title?: string; visibility?: "PUBLIC" | "CONNECTIONS" };
// Bluesky posts. media_type left out follows the media, as for LinkedIn. alt_text is one
// description per image, in order.
export type BlueskyOptions = { kind: "bluesky"; media_type?: "text" | "image" | "video"; text?: string; alt_text?: string[] };
// X posts. media_type left out follows the media. alt_text is one description per image.
export type XOptions = { kind: "x"; media_type?: "text" | "image" | "video"; text?: string; alt_text?: string[] };
// A video's cover, on any platform's options: an image from the library, or a frame of the
// video (milliseconds from the start). Which platforms can use which: coverSupport().
export type CoverOptions = { cover_media_id?: string; cover_time_ms?: number };
export type DestinationOptions = (InstagramOptions | FacebookOptions | ThreadsOptions | YouTubeOptions | TikTokOptions | LinkedInOptions | BlueskyOptions | XOptions) & CoverOptions;

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
  linkedin: ["text", "image", "video"],
  bluesky: ["text", "image", "video"],
  x: ["text", "image", "video"],
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
  const result = normalizeKind(platform, raw);
  if (!result.options) return result;
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const problems = [...result.problems];
  const cover: CoverOptions = {};
  if (input.cover_media_id !== undefined && input.cover_media_id !== null) {
    if (typeof input.cover_media_id === "string" && UUID.test(input.cover_media_id)) cover.cover_media_id = input.cover_media_id.toLowerCase();
    else problems.push("cover_media_id must be the id of an image in your media library.");
  }
  if (input.cover_time_ms !== undefined && input.cover_time_ms !== null) {
    if (Number.isInteger(input.cover_time_ms) && (input.cover_time_ms as number) >= 0) cover.cover_time_ms = input.cover_time_ms as number;
    else problems.push("cover_time_ms must be a whole number of milliseconds from the start of the video, 0 or more.");
  }
  return { options: { ...result.options, ...cover }, problems };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What each destination can do with a cover. "image": a library image; "frame": a moment of
// the video. Facebook would need extra Page permissions; Threads and TikTok drafts have no
// cover option; TikTok only takes a frame.
export function coverSupport(options: DestinationOptions, media: Array<Pick<MediaFacts, "media_type">>): { image: boolean; frame: boolean; why?: string } {
  const isVideo = media.some((m) => m.media_type === "video");
  switch (options.kind) {
    case "instagram":
      return options.media_type === "reel" ? { image: true, frame: true } : { image: false, frame: false, why: "Covers apply to Instagram Reels only." };
    case "youtube":
      return { image: true, frame: true };
    case "tiktok":
      if (tiktokMediaType(options, media) === "photo") return { image: false, frame: false, why: "TikTok photo posts use their first photo as the cover; put the one you want first." };
      if (options.delivery_mode === "inbox") return { image: false, frame: false, why: "Post Social can't set the cover of a TikTok draft; choose it in TikTok before posting." };
      return { image: false, frame: true, why: "TikTok doesn't accept a cover image; pick a frame of the video instead." };
    case "facebook":
      return { image: false, frame: false, why: isVideo ? "Post Social can't set a Facebook video cover yet; Facebook uses its own thumbnail." : "Covers apply to videos only." };
    case "threads":
      return { image: false, frame: false, why: "Threads doesn't support custom covers." };
    case "linkedin":
      return linkedinMediaType(options, media) === "video" ? { image: true, frame: true } : { image: false, frame: false, why: "Covers apply to videos only." };
    case "bluesky":
      return { image: false, frame: false, why: "Bluesky makes its own video thumbnail." };
    case "x":
      return { image: false, frame: false, why: "Post Social can't set an X video cover yet; X uses its own thumbnail." };
  }
}

function normalizeKind(platform: Platform, raw: unknown): { options?: DestinationOptions; problems: string[] } {
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
      if (str("media_type") !== undefined && !pick("media_type", ["video", "photo"] as const)) return { problems: ["Choose a TikTok post type: video or photo."] };
      return {
        options: {
          kind: "tiktok",
          delivery_mode,
          media_type: pick("media_type", ["video", "photo"] as const),
          title: str("title"),
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
    case "linkedin": {
      if (str("media_type") !== undefined && !pick("media_type", ["text", "image", "video"] as const)) return { problems: ["Choose a LinkedIn post type: text, image or video."] };
      if (str("visibility") !== undefined && !pick("visibility", ["PUBLIC", "CONNECTIONS"] as const)) return { problems: ["Choose who can see the LinkedIn post: PUBLIC or CONNECTIONS."] };
      return {
        options: {
          kind: "linkedin",
          media_type: pick("media_type", ["text", "image", "video"] as const),
          text: str("text"),
          title: str("title"),
          visibility: pick("visibility", ["PUBLIC", "CONNECTIONS"] as const, "PUBLIC"),
        },
        problems: [],
      };
    }
    case "bluesky": {
      if (str("media_type") !== undefined && !pick("media_type", ["text", "image", "video"] as const)) return { problems: ["Choose a Bluesky post type: text, image or video."] };
      const alt = Array.isArray(input.alt_text) ? input.alt_text : undefined;
      if (alt && (alt.length > BLUESKY_MAX_IMAGES || alt.some((a) => typeof a !== "string"))) return { problems: [`Bluesky alt_text is a list of up to ${BLUESKY_MAX_IMAGES} descriptions, one per image.`] };
      return {
        options: { kind: "bluesky", media_type: pick("media_type", ["text", "image", "video"] as const), text: str("text"), alt_text: alt as string[] | undefined },
        problems: [],
      };
    }
    case "x": {
      if (str("media_type") !== undefined && !pick("media_type", ["text", "image", "video"] as const)) return { problems: ["Choose an X post type: text, image or video."] };
      const alt = Array.isArray(input.alt_text) ? input.alt_text : undefined;
      if (alt && (alt.length > X_MAX_IMAGES || alt.some((a) => typeof a !== "string"))) return { problems: [`X alt_text is a list of up to ${X_MAX_IMAGES} descriptions, one per image.`] };
      return { options: { kind: "x", media_type: pick("media_type", ["text", "image", "video"] as const), text: str("text"), alt_text: alt as string[] | undefined }, problems: [] };
    }
  }
}

export const BLUESKY_MAX_IMAGES = 4;
export const X_MAX_IMAGES = 4;
export const X_MAX_WEIGHT = 280;
export const BLUESKY_MAX_CHARS = 300;

// Bluesky counts characters as people see them (grapheme clusters), so an emoji is one.
export function graphemeCount(text: string) {
  const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(input: string): Iterable<unknown> } }).Segmenter;
  if (!Segmenter) return [...text].length;
  let count = 0;
  for (const _ of new Segmenter(undefined, { granularity: "grapheme" }).segment(text)) count++;
  return count;
}

// A LinkedIn post's type: as chosen, or from the media.
export function linkedinMediaType(options: LinkedInOptions, media: Array<Pick<MediaFacts, "media_type">>): "text" | "image" | "video" {
  if (options.media_type) return options.media_type;
  if (!media.length) return "text";
  return media.some((m) => m.media_type === "video") ? "video" : "image";
}

export const LINKEDIN_MAX_IMAGES = 20;

// A TikTok post's type: as chosen, or from the media (only images means a photo post).
export function tiktokMediaType(options: TikTokOptions, media: Array<Pick<MediaFacts, "media_type">>): "video" | "photo" {
  if (options.media_type) return options.media_type;
  return media.length > 0 && media.every((m) => m.media_type === "image") ? "photo" : "video";
}

export const TIKTOK_MAX_PHOTOS = 35;

function coverProblems(options: DestinationOptions, media: MediaFacts[], cover?: MediaFacts): string[] {
  const wantsImage = options.cover_media_id !== undefined;
  const wantsFrame = options.cover_time_ms !== undefined;
  if (!wantsImage && !wantsFrame) return [];
  if (wantsImage && wantsFrame) return ["Choose a cover image or a cover frame, not both."];
  const support = coverSupport(options, media);
  if (wantsImage && !support.image) return [support.why ?? "This post can't use a cover image."];
  if (wantsFrame && !support.frame) return [support.why ?? "This post can't use a cover frame."];
  const problems: string[] = [];
  if (wantsImage && cover) {
    if (cover.media_type !== "image") problems.push(`The cover must be an image; ${cover.name} is a video.`);
    else if (cover.status !== "ready") problems.push(`The cover image ${cover.name} is ${cover.status === "processing" ? "still being checked" : cover.status}.`);
    else if (!["image/jpeg", "image/png", "image/webp"].includes(cover.mime_type)) problems.push(`The cover image must be JPEG, PNG or WebP; ${cover.name} is ${cover.mime_type}.`);
  }
  if (wantsFrame) {
    const seconds = media.find((m) => m.media_type === "video")?.duration_seconds;
    if (seconds && options.cover_time_ms! > seconds * 1000) problems.push(`The cover frame is at ${(options.cover_time_ms! / 1000).toFixed(1)}s, but the video is ${seconds.toFixed(1)}s long.`);
  }
  return problems;
}

export function captionFor(options: DestinationOptions, postCaption: string) {
  if (options.kind === "instagram") return options.caption ?? postCaption;
  if (options.kind === "facebook") return options.message ?? postCaption;
  if (options.kind === "threads") return options.text ?? postCaption;
  if (options.kind === "youtube") return options.description ?? postCaption;
  if (options.kind === "linkedin") return options.text ?? postCaption;
  if (options.kind === "bluesky") return options.text ?? postCaption;
  if (options.kind === "x") return options.text ?? postCaption;
  return postCaption;
}

// All problems for one destination. Empty means it can be sent.
export function destinationProblems(args: {
  options: DestinationOptions;
  caption: string;
  media: MediaFacts[];
  capabilities?: Capabilities;
  // The cover image's facts when options.cover_media_id is set (omit if it can't be loaded).
  cover?: MediaFacts;
}): string[] {
  const { options, media, capabilities } = args;
  const caption = captionFor(options, args.caption).trim();
  const problems: string[] = [];
  const videos = media.filter((m) => m.media_type === "video");
  const images = media.filter((m) => m.media_type === "image");
  problems.push(...coverProblems(options, media, args.cover));

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
      const what = options.delivery_mode === "inbox" ? "A TikTok draft" : "A TikTok post";
      if (tiktokMediaType(options, media) === "photo") {
        if (videos.length) problems.push("TikTok photo posts can only contain images; post videos separately.");
        if (images.length === 0) problems.push(`${what} with photos needs at least 1 image.`);
        if (images.length > TIKTOK_MAX_PHOTOS) problems.push(`TikTok photo posts can have at most ${TIKTOK_MAX_PHOTOS} images; this one has ${images.length}.`);
        types(images, ["image/jpeg", "image/png", "image/webp"], "TikTok photos");
        if ((options.title ?? "").length > 90) problems.push(`TikTok photo titles can be at most 90 characters; this one is ${(options.title ?? "").length}.`);
        if (caption.length > 4000) problems.push(`TikTok photo captions can be at most 4,000 characters; this one is ${caption.length.toLocaleString("en-US")}.`);
        if (options.duet_enabled || options.stitch_enabled) problems.push("Duet and Stitch aren't available for TikTok photo posts; turn them off.");
      } else {
        const max = capabilities?.video_max_seconds ?? 600;
        exactly(1, "video", what);
        types(videos, ["video/mp4", "video/quicktime", "video/webm"], "TikTok videos");
        videos.forEach((v) => videoLength(v, 3, max, "Videos on this TikTok account"));
        if (options.title) problems.push("TikTok videos don't have a separate title; put it in the caption.");
        if (options.delivery_mode === "direct" && caption.length > 2200) problems.push(`TikTok captions can be at most 2,200 characters; this one is ${caption.length.toLocaleString("en-US")}.`);
      }
      if (options.delivery_mode === "direct") {
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

    case "linkedin": {
      const length = [...caption].length;
      if (length > 3000) problems.push(`LinkedIn posts can be at most 3,000 characters; this one is ${length.toLocaleString("en-US")}.`);
      if ((options.title ?? "").length > 200) problems.push("LinkedIn video titles can be at most 200 characters.");
      const type = linkedinMediaType(options, media);
      if (type === "text") {
        if (!caption) problems.push("Write the text for this LinkedIn post.");
        if (media.length) problems.push("A LinkedIn text post cannot include media; choose image or video instead.");
      } else if (type === "image") {
        if (videos.length) problems.push("LinkedIn image posts can only contain images; post the video separately.");
        if (images.length === 0) problems.push("A LinkedIn image post needs at least 1 image.");
        if (images.length > LINKEDIN_MAX_IMAGES) problems.push(`LinkedIn posts can have at most ${LINKEDIN_MAX_IMAGES} images; this one has ${images.length}.`);
        types(images, ["image/jpeg", "image/png", "image/gif"], "LinkedIn images");
      } else {
        exactly(1, "video", "A LinkedIn video post");
        types(videos, ["video/mp4"], "LinkedIn videos");
        videos.forEach((v) => {
          videoLength(v, 3, 1800, "LinkedIn videos");
          if (v.size_bytes > 500 * 1024 * 1024) problems.push(`LinkedIn videos can be at most 500 MB; ${v.name} is ${Math.round(v.size_bytes / 1024 / 1024)} MB.`);
          if (v.size_bytes < 75 * 1024) problems.push(`LinkedIn videos must be at least 75 KB; ${v.name} is smaller.`);
        });
      }
      break;
    }
    case "bluesky": {
      const length = graphemeCount(caption);
      if (length > BLUESKY_MAX_CHARS) problems.push(`Bluesky posts can be at most ${BLUESKY_MAX_CHARS} characters; this one is ${length.toLocaleString("en-US")}.`);
      const type = linkedinMediaType(options as unknown as LinkedInOptions, media);
      if (type === "text") {
        if (!caption) problems.push("Write the text for this Bluesky post.");
        if (media.length) problems.push("A Bluesky text post cannot include media; choose image or video instead.");
      } else if (type === "image") {
        if (videos.length) problems.push("Bluesky image posts can only contain images; post the video separately.");
        if (images.length === 0) problems.push("A Bluesky image post needs at least 1 image.");
        if (images.length > BLUESKY_MAX_IMAGES) problems.push(`Bluesky posts can have at most ${BLUESKY_MAX_IMAGES} images; this one has ${images.length}.`);
        types(images, ["image/jpeg", "image/png", "image/webp", "image/gif"], "Bluesky images");
        for (const [i, alt] of (options.alt_text ?? []).entries()) if (alt.length > 2000) problems.push(`Bluesky image descriptions can be at most 2,000 characters; number ${i + 1} is longer.`);
      } else {
        exactly(1, "video", "A Bluesky video post");
        types(videos, ["video/mp4"], "Bluesky videos");
        videos.forEach((v) => {
          videoLength(v, null, 180, "Bluesky videos");
          if (v.size_bytes > 100 * 1024 * 1024) problems.push(`Bluesky videos can be at most 100 MB; ${v.name} is ${Math.round(v.size_bytes / 1024 / 1024)} MB.`);
        });
      }
      break;
    }
    case "x": {
      const weight = xWeightedLength(caption);
      if (weight > X_MAX_WEIGHT) problems.push(`X posts can be at most ${X_MAX_WEIGHT} characters (links count as 23, emoji as 2); this one counts as ${weight}.`);
      const type = linkedinMediaType(options as unknown as LinkedInOptions, media);
      if (type === "text") {
        if (!caption) problems.push("Write the text for this X post.");
        if (media.length) problems.push("An X text post cannot include media; choose image or video instead.");
      } else if (type === "image") {
        if (videos.length) problems.push("X image posts can only contain images; post the video separately.");
        if (images.length === 0) problems.push("An X image post needs at least 1 image.");
        if (images.length > X_MAX_IMAGES) problems.push(`X posts can have at most ${X_MAX_IMAGES} images; this one has ${images.length}.`);
        types(images, ["image/jpeg", "image/png", "image/webp", "image/gif"], "X images");
        if (images.some((i) => i.mime_type === "image/gif") && images.length > 1) problems.push("An X post with a GIF can have only that one GIF.");
        for (const i of images) {
          const max = i.mime_type === "image/gif" ? 15 : 5;
          if (i.size_bytes > max * 1024 * 1024) problems.push(`X ${i.mime_type === "image/gif" ? "GIFs" : "images"} can be at most ${max} MB; ${i.name} is ${(i.size_bytes / 1024 / 1024).toFixed(1)} MB.`);
        }
        for (const [i, alt] of (options.alt_text ?? []).entries()) if (alt.length > 1000) problems.push(`X image descriptions can be at most 1,000 characters; number ${i + 1} is longer.`);
      } else {
        exactly(1, "video", "An X video post");
        types(videos, ["video/mp4", "video/quicktime"], "X videos");
        videos.forEach((v) => {
          videoLength(v, null, capabilities?.video_max_seconds ?? 140, "X videos");
          if (v.size_bytes > 512 * 1024 * 1024) problems.push(`X videos can be at most 512 MB; ${v.name} is ${Math.round(v.size_bytes / 1024 / 1024)} MB.`);
        });
      }
      break;
    }
  }
  return problems;
}
