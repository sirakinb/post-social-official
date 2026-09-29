import type { Doc } from "../_generated/dataModel";

type MediaInput = {
  mediaType: "image" | "video";
  mimeType: string;
  durationSeconds?: number;
};

type DestinationOptions = Doc<"destinations">["options"];

export function validateDestinationForPublish(args: {
  options: DestinationOptions;
  media: MediaInput[];
  caption: string;
  now: number;
}) {
  const { options, media, caption, now } = args;
  if (options.kind === "tiktok") {
    const videos = media.filter((asset) => asset.mediaType === "video");
    const images = media.filter((asset) => asset.mediaType === "image");
    if (options.deliveryMode === "inbox") {
      // Draft upload sends only the video. Privacy, interactions, disclosure and caption are set by the creator inside TikTok.
      if (videos.length !== 1 || images.length > 0) throw new Error("TikTok draft upload takes exactly one video.");
      for (const asset of videos) {
        if (!["video/mp4", "video/quicktime"].includes(asset.mimeType)) throw new Error("TikTok video posts require an MP4 or MOV file.");
        if (asset.durationSeconds !== undefined && asset.durationSeconds > options.creatorInfoSnapshot.maxVideoDurationSec) throw new Error("A video is longer than this TikTok account allows.");
      }
      return;
    }
    if (videos.length === 0 && images.length === 0) throw new Error("TikTok needs a video or at least one image.");
    if (videos.length > 1 || (videos.length === 1 && images.length > 0)) throw new Error("A TikTok video post accepts one video; a photo post accepts images only.");
    if (images.length > 35) throw new Error("TikTok accepts up to 35 images in one photo post.");
    if (caption.length > 2200) throw new Error("Shorten the TikTok caption to 2,200 characters or fewer.");
    if (!options.privacyLevel) throw new Error("Choose a TikTok privacy setting.");
    if (!options.creatorInfoSnapshot.privacyLevelOptions.includes(options.privacyLevel)) throw new Error("Refresh TikTok account options and choose one of the privacy settings TikTok currently allows.");
    if (!options.creatorInfoSnapshot.canPost) throw new Error("TikTok says this creator cannot post right now.");
    if (options.commentEnabled && !options.creatorInfoSnapshot.commentAvailable) throw new Error("Comments are not available for this TikTok account.");
    if (options.duetEnabled && !options.creatorInfoSnapshot.duetAvailable) throw new Error("Duet is not available for this TikTok account.");
    if (options.stitchEnabled && !options.creatorInfoSnapshot.stitchAvailable) throw new Error("Stitch is not available for this TikTok account.");
    if (!options.disclosureEnabled && (options.yourBrandEnabled || options.brandedContentEnabled)) throw new Error("Turn on content disclosure before selecting a brand disclosure.");
    if (now - options.creatorInfoCheckedAt > 10 * 60 * 1000) throw new Error("Refresh TikTok account options before publishing.");
    for (const asset of media) {
      if (asset.mediaType === "video" && !["video/mp4", "video/quicktime"].includes(asset.mimeType)) throw new Error("TikTok video posts require an MP4 or MOV file.");
      if (asset.mediaType === "video" && asset.durationSeconds !== undefined && asset.durationSeconds > options.creatorInfoSnapshot.maxVideoDurationSec) throw new Error("A video is longer than this TikTok account allows.");
    }
    return;
  }

  if (options.kind === "instagram") {
    const expectedCount = options.mediaType === "carousel" ? media.length >= 2 && media.length <= 10 : media.length === 1;
    if (!expectedCount) throw new Error(options.mediaType === "carousel" ? "Instagram carousels require 2 to 10 media files." : "An Instagram image or Reel post requires exactly one media file.");
    if (options.mediaType === "image" && media[0]?.mediaType !== "image") throw new Error("Choose an image for this Instagram post.");
    if (options.mediaType === "reel" && media[0]?.mediaType !== "video") throw new Error("Choose a video for this Instagram Reel.");
    return;
  }

  if (options.kind === "threads") {
    const text = options.text.trim();
    if (!text) throw new Error("Write something for this Threads post.");
    if (text.length > 500) throw new Error("Shorten the Threads text to 500 characters or fewer.");
    if (options.mediaType === "text" && media.length !== 0) {
      throw new Error("A text-only Threads post cannot include ignored media files.");
    }
    if (options.mediaType === "image" && (media.length !== 1 || media[0]?.mediaType !== "image")) {
      throw new Error("A Threads image post requires exactly one image.");
    }
    return;
  }

  if (options.kind === "youtube") {
    const title = options.title.trim();
    if (!title) throw new Error("Add a title for the YouTube video.");
    if (title.length > 100) throw new Error("Shorten the YouTube title to 100 characters or fewer.");
    if ((options.description ?? "").length > 5000) throw new Error("Shorten the YouTube description to 5,000 characters or fewer.");
    if (media.length !== 1 || media[0]?.mediaType !== "video") throw new Error("A YouTube Short requires exactly one video file.");
    return;
  }

  if (options.mediaType === "video") throw new Error("Facebook video publishing is not enabled in this version.");
  if (options.mediaType === "feed" && media.length !== 0) throw new Error("A Facebook feed-only post cannot include ignored media files.");
  if (options.mediaType === "image" && (media.length !== 1 || media[0]?.mediaType !== "image")) throw new Error("A Facebook image post requires exactly one image.");
}
